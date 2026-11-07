import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { emailNotifications } from "@/db/schema";
import {
  dispatchPending,
  enqueue,
  recipientsByUserIds,
  type EnqueueInput,
} from "@/lib/email/outbox";
import { setTransportForTests, type EmailTransport } from "@/lib/email/transport";
import { count, makeAgent, makeOrg, resetDb } from "../setup/factories";
import { useSilentTransport } from "../setup/transport";

const content = { subject: "Hello", text: "text", html: "<p>html</p>" };
const row = (organizationId: string, n = 0): EnqueueInput => ({
  kind: "user_invitation",
  content,
  toEmail: `person-${n}@example.test`,
  organizationId,
});

function fakeTransport(send: EmailTransport["send"]): EmailTransport {
  return { name: "fake", send };
}

beforeEach(async () => {
  await resetDb();
});
afterEach(() => {
  useSilentTransport();
  vi.restoreAllMocks();
});

describe("outbox", () => {
  test("a rolled-back action leaves no notification", async () => {
    const org = await makeOrg();
    await expect(
      db.transaction(async (tx) => {
        await enqueue(tx, [row(org.id)]);
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect(await count(emailNotifications)).toBe(0);
  });

  test("console transport marks rows sent", async () => {
    const org = await makeOrg();
    vi.spyOn(console, "info").mockImplementation(() => {});
    await enqueue(db, [row(org.id, 1), row(org.id, 2)]);
    expect(await dispatchPending()).toEqual({ sent: 2, failed: 0, deferred: 0 });
    const rows = await db.select().from(emailNotifications);
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.status).toBe("sent");
      expect(r.sentAt).toBeInstanceOf(Date);
    }
  });

  test("five failures mark a row failed", async () => {
    const org = await makeOrg();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const send = vi.fn().mockRejectedValue(new Error("smtp down"));
    setTransportForTests(fakeTransport(send));
    await enqueue(db, [row(org.id)]);

    for (let i = 0; i < 4; i += 1) {
      expect(await dispatchPending()).toEqual({ sent: 0, failed: 0, deferred: 1 });
    }
    expect(await dispatchPending()).toEqual({ sent: 0, failed: 1, deferred: 0 });

    const [r] = await db.select().from(emailNotifications);
    expect(r.status).toBe("failed");
    expect(r.attempts).toBe(5);
    expect(r.lastError).toBe("smtp down");
    expect(send).toHaveBeenCalledTimes(5);
  });

  test("two dispatchers never send the same row twice", async () => {
    const org = await makeOrg();
    await enqueue(db, Array.from({ length: 20 }, (_, i) => row(org.id, i)));
    const seen: string[] = [];
    setTransportForTests(
      fakeTransport(async (email) => {
        seen.push(email.to);
        await new Promise((r) => setTimeout(r, 5));
      }),
    );
    const [a, b] = await Promise.all([dispatchPending(50), dispatchPending(50)]);
    expect(seen).toHaveLength(20);
    expect(new Set(seen).size).toBe(20);
    expect(a.sent + b.sent).toBe(20);
    const rows = await db
      .select()
      .from(emailNotifications)
      .where(eq(emailNotifications.status, "sent"));
    expect(rows).toHaveLength(20);
  });

  test("recipientsByUserIds returns active users of that organization only", async () => {
    const org = await makeOrg();
    const other = await makeOrg();
    const mine = await makeAgent(org.id);
    const disabled = await makeAgent(org.id, "agent", { status: "disabled" });
    const foreign = await makeAgent(other.id);

    const result = await recipientsByUserIds(org.id, [mine.id, disabled.id, foreign.id]);
    expect(result).toEqual([
      { userId: mine.id, email: mine.email, name: `${mine.firstName} ${mine.lastName}` },
    ]);
    expect(await recipientsByUserIds(org.id, [])).toEqual([]);
  });
});

describe("outbox lease", () => {
  const onlyRow = async () => (await db.select().from(emailNotifications))[0];
  const setLease = (interval: string) =>
    db.execute(
      sql`update email_notifications set claimed_until = now() + ${interval}::interval`,
    );

  test("a row with a live lease is skipped", async () => {
    const org = await makeOrg();
    await enqueue(db, [row(org.id)]);
    await setLease("5 minutes");
    const send = vi.fn().mockResolvedValue(undefined);
    setTransportForTests(fakeTransport(send));
    expect(await dispatchPending()).toEqual({ sent: 0, failed: 0, deferred: 0 });
    expect(send).not.toHaveBeenCalled();
  });

  test("a row with an expired lease is re-claimed and its attempts go up", async () => {
    const org = await makeOrg();
    await enqueue(db, [row(org.id)]);
    await db.execute(
      sql`update email_notifications set attempts = 1, claimed_until = now() - interval '1 minute'`,
    );
    setTransportForTests(fakeTransport(async () => {}));
    expect(await dispatchPending()).toEqual({ sent: 1, failed: 0, deferred: 0 });
    const r = await onlyRow();
    expect(r.attempts).toBe(2);
    expect(r.status).toBe("sent");
    expect(r.claimedUntil).toBeNull();
  });

  test("an exhausted row with an expired lease becomes failed", async () => {
    const org = await makeOrg();
    await enqueue(db, [row(org.id)]);
    await db.execute(
      sql`update email_notifications set attempts = 5, claimed_until = now() - interval '1 minute'`,
    );
    const send = vi.fn().mockResolvedValue(undefined);
    setTransportForTests(fakeTransport(send));
    await dispatchPending();
    const r = await onlyRow();
    expect(r.status).toBe("failed");
    expect(r.claimedUntil).toBeNull();
    expect(r.lastError).toBe("Dispatcher did not finish the final attempt");
    expect(send).not.toHaveBeenCalled();
  });

  test("out of budget gives the attempt back and releases the lease", async () => {
    const org = await makeOrg();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await enqueue(db, [row(org.id)]);
    const send = vi.fn().mockResolvedValue(undefined);
    setTransportForTests(fakeTransport(send));
    expect(await dispatchPending(50, -1)).toEqual({ sent: 0, failed: 0, deferred: 0 });
    const r = await onlyRow();
    expect(r.attempts).toBe(0);
    expect(r.status).toBe("pending");
    expect(r.claimedUntil).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });

  test("a failed status write after a successful send is not recorded as a send failure", async () => {
    const org = await makeOrg();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await enqueue(db, [row(org.id)]);
    setTransportForTests(
      fakeTransport(async () => {
        // The send succeeds, then the status write cannot happen.
        await db.execute(
          sql`alter table email_notifications add constraint tmp_never_sent check (status <> 'sent') not valid`,
        );
      }),
    );
    try {
      const result = await dispatchPending();
      expect(result.failed).toBe(0);
      expect(result.deferred).toBe(0);
      expect(err).toHaveBeenCalled();
    } finally {
      await db.execute(
        sql`alter table email_notifications drop constraint if exists tmp_never_sent`,
      );
    }
    const r = await onlyRow();
    expect(r.status).toBe("pending");
    expect(r.lastError).toBeNull();
  });
});
