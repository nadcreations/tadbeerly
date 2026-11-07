import { and, eq, inArray, sql } from "drizzle-orm";
import { db, type Executor } from "@/db";
import { emailNotifications, users } from "@/db/schema";
import { getTransport } from "./transport";
import { normaliseEmail } from "@/lib/format";
import type { EmailContent } from "./templates";

export type NotificationKind =
  | "user_invitation"
  | "invitation_accepted"
  | "password_reset";

export type EnqueueInput = {
  kind: NotificationKind;
  content: EmailContent;
  toEmail: string;
  toName?: string | null;
  organizationId: string;
  recipientUserId?: string | null;
  entityType?: string;
  entityId?: string;
};

/**
 * Writes notifications into the outbox. Call this inside the same transaction
 * as the action that caused it: a notification is then never lost to a mail
 * server outage, and never sent for an action that rolled back.
 */
export async function enqueue(
  exec: Executor,
  rows: EnqueueInput[],
): Promise<void> {
  if (!rows.length) return;

  await exec.insert(emailNotifications).values(
    rows.map((row) => ({
      kind: row.kind,
      subject: row.content.subject,
      bodyText: row.content.text,
      bodyHtml: row.content.html,
      toEmail: normaliseEmail(row.toEmail),
      toName: row.toName ?? null,
      organizationId: row.organizationId,
      recipientUserId: row.recipientUserId ?? null,
      entityType: row.entityType ?? null,
      entityId: row.entityId ?? null,
    })),
  );
}

export type Recipient = { userId: string; email: string; name: string };

/**
 * Active users of `organizationId` among `userIds`. An ID that belongs to
 * another organization is ignored, never returned.
 */
export async function recipientsByUserIds(
  organizationId: string,
  userIds: string[],
  exec: Executor = db,
): Promise<Recipient[]> {
  if (!userIds.length) return [];

  const rows = await exec
    .select({
      id: users.id,
      email: users.email,
      firstName: users.firstName,
      lastName: users.lastName,
    })
    .from(users)
    .where(
      and(
        eq(users.organizationId, organizationId),
        inArray(users.id, userIds),
        eq(users.status, "active"),
      ),
    );

  return rows.map((r) => ({
    userId: r.id,
    email: r.email,
    name: `${r.firstName} ${r.lastName}`.trim(),
  }));
}

const MAX_ATTEMPTS = 5;

/** How long a claim holds a row. Covers the send budget plus the worst single send. */
const LEASE = sql`interval '5 minutes'`;

/**
 * Drains the outbox.
 *
 * Rows are claimed with an autocommitted lease: one statement picks pending
 * rows nobody holds (`FOR UPDATE SKIP LOCKED`), bumps `attempts` and sets
 * `claimed_until`. The sends then happen outside any transaction and each
 * outcome is recorded on its own, fenced on the attempt number it claimed, so
 * a slow dispatcher can never overwrite a newer claim. A dispatcher that dies
 * mid-send simply lets its lease expire; the row is then re-claimed with its
 * attempt already counted, and a row whose final attempt never finished is
 * swept to `failed`. Delivery is at-least-once, which is the right trade for
 * email.
 */
export async function dispatchPending(
  limit = 50,
  budgetMs = 20_000,
): Promise<{ sent: number; failed: number; deferred: number }> {
  // Rows whose last permitted attempt died without recording an outcome.
  await db.execute(sql`
    update ${emailNotifications}
    set status = 'failed',
        claimed_until = null,
        last_error = coalesce(last_error, 'Dispatcher did not finish the final attempt')
    where status = 'pending'
      and attempts >= ${MAX_ATTEMPTS}
      and claimed_until < now()
  `);

  const claimed = await db.execute(sql`
    update ${emailNotifications}
    set attempts = ${emailNotifications.attempts} + 1,
        claimed_until = now() + ${LEASE}
    where id in (
      select id from ${emailNotifications}
      where ${emailNotifications.status} = 'pending'
        and ${emailNotifications.attempts} < ${MAX_ATTEMPTS}
        and (claimed_until is null or claimed_until < now())
      order by ${emailNotifications.createdAt}
      limit ${limit}
      for update skip locked
    )
    returning id, to_email, to_name, subject, body_text, body_html, attempts
  `);

  const rows = claimed as unknown as {
    id: string;
    to_email: string;
    to_name: string | null;
    subject: string;
    body_text: string;
    body_html: string;
    attempts: number;
  }[];

  if (!rows.length) return { sent: 0, failed: 0, deferred: 0 };

  const transport = getTransport();
  let sent = 0;
  let failed = 0;
  let deferred = 0;

  /*
   * A wall-clock budget, because this runs inside a request. Stopping early
   * leaves unreached rows pending for the next run.
   */
  const deadline = Date.now() + budgetMs;
  let ranOutOfTime = 0;

  // Fenced on the claim: a row re-claimed by someone else has a new attempt number.
  const claim = (row: { id: string; attempts: number }) =>
    and(
      eq(emailNotifications.id, row.id),
      eq(emailNotifications.attempts, row.attempts),
    );

  for (const row of rows) {
    if (Date.now() > deadline) {
      // Claimed but not attempted: give the attempt back and release the lease.
      await db
        .update(emailNotifications)
        .set({ attempts: row.attempts - 1, claimedUntil: null })
        .where(claim(row));
      ranOutOfTime += 1;
      continue;
    }

    let sendError: unknown = null;
    try {
      await transport.send({
        to: row.to_email,
        toName: row.to_name,
        subject: row.subject,
        text: row.body_text,
        html: row.body_html,
      });
    } catch (error) {
      sendError = error;
    }

    // Outside the send's try: a failed write after a good send is not a send
    // failure. The lease expiry recovers the row.
    try {
      if (sendError === null) {
        await db
          .update(emailNotifications)
          .set({
            status: "sent",
            sentAt: sql`now()`,
            lastError: null,
            claimedUntil: null,
          })
          .where(claim(row));
        sent += 1;
      } else {
        const message =
          sendError instanceof Error ? sendError.message : String(sendError);
        const exhausted = row.attempts >= MAX_ATTEMPTS;
        await db
          .update(emailNotifications)
          .set({
            status: exhausted ? "failed" : "pending",
            lastError: message.slice(0, 1000),
            claimedUntil: null,
          })
          .where(claim(row));
        if (exhausted) {
          failed += 1;
          console.error(
            `[email] giving up on ${row.id} after ${row.attempts} attempts: ${message}`,
          );
        } else {
          deferred += 1;
          console.warn(`[email] deferring ${row.id}: ${message}`);
        }
      }
    } catch (writeError) {
      console.error(
        `[email] could not record the outcome for ${row.id}; its lease will expire and it will be retried`,
        writeError,
      );
    }
  }

  if (ranOutOfTime > 0) {
    console.warn(
      `[email] ran out of time with ${ranOutOfTime} still queued; they stay pending`,
    );
  }

  return { sent, failed, deferred };
}

/**
 * Best-effort immediate delivery, called after an action commits. The outbox
 * plus the cron endpoint are what make delivery reliable; this only shortens
 * the wait in the common case, so its failures are logged and swallowed.
 *
 * Awaited rather than left running: on a serverless platform the container is
 * frozen when the handler returns, leaving a half-finished send. A small batch
 * and a short budget keep the person waiting on a click from waiting on the
 * whole outbox; anything not attempted stays pending for the cron endpoint.
 */
export async function dispatchSoon(): Promise<void> {
  try {
    await dispatchPending(5, 5_000);
  } catch (error) {
    // Delivery must never fail the action that queued it.
    console.error("[email] immediate dispatch failed", error);
  }
}
