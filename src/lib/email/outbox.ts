import { and, eq, inArray, sql } from "drizzle-orm";
import { db, type Executor } from "@/db";
import { emailNotifications, users } from "@/db/schema";
import { getTransport } from "./transport";
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
      toEmail: row.toEmail,
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
): Promise<Recipient[]> {
  if (!userIds.length) return [];

  const rows = await db
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

/**
 * Drains the outbox.
 *
 * Rows are claimed with `FOR UPDATE SKIP LOCKED` inside a transaction that
 * stays open until every claimed row has been sent and recorded. The row locks
 * are what keep a second dispatcher away: a claim that committed before the
 * send would leave the rows `pending` and claimable again while the first
 * dispatcher is still talking to the mail server, and the message would go out
 * twice. If the process dies mid-send the transaction rolls back and the rows
 * are simply retried. Delivery is at-least-once, which is the right trade for
 * email.
 */
export async function dispatchPending(
  limit = 50,
  budgetMs = 20_000,
): Promise<{ sent: number; failed: number; deferred: number }> {
  return db.transaction(async (tx) => {
    const claimed = await tx.execute(sql`
      update ${emailNotifications}
      set attempts = ${emailNotifications.attempts} + 1
      where id in (
        select id from ${emailNotifications}
        where ${emailNotifications.status} = 'pending'
          and ${emailNotifications.attempts} < ${MAX_ATTEMPTS}
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
     * A wall-clock budget, because this runs inside a request. A batch against
     * a mail server that is timing out would otherwise outlive the platform's
     * own limit and leave unreached rows looking like failed ones. Stopping
     * early leaves them pending for the next run.
     */
    const deadline = Date.now() + budgetMs;
    let ranOutOfTime = 0;

    for (const row of rows) {
      if (Date.now() > deadline) {
        // Claimed but not attempted: give the attempt back rather than counting it.
        await tx
          .update(emailNotifications)
          .set({ attempts: sql`${emailNotifications.attempts} - 1` })
          .where(eq(emailNotifications.id, row.id));
        ranOutOfTime += 1;
        continue;
      }
      try {
        await transport.send({
          to: row.to_email,
          toName: row.to_name,
          subject: row.subject,
          text: row.body_text,
          html: row.body_html,
        });

        await tx
          .update(emailNotifications)
          .set({ status: "sent", sentAt: new Date(), lastError: null })
          .where(eq(emailNotifications.id, row.id));
        sent += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const exhausted = row.attempts >= MAX_ATTEMPTS;

        await tx
          .update(emailNotifications)
          .set({
            status: exhausted ? "failed" : "pending",
            lastError: message.slice(0, 1000),
          })
          .where(eq(emailNotifications.id, row.id));

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
    }

    if (ranOutOfTime > 0) {
      console.warn(
        `[email] ran out of time with ${ranOutOfTime} still queued; they stay pending`,
      );
    }

    return { sent, failed, deferred };
  });
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
