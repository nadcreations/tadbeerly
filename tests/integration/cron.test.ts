import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { POST } from "@/app/api/cron/notifications/route";
import { db } from "@/db";
import { emailNotifications } from "@/db/schema";
import { enqueue, type EnqueueInput } from "@/lib/email/outbox";
import { setTransportForTests } from "@/lib/email/transport";
import { makeOrg, resetDb } from "../setup/factories";
import { useSilentTransport } from "../setup/transport";

const call = (secret?: string) =>
  POST(
    new Request("http://localhost/api/cron/notifications", {
      method: "POST",
      headers: secret === undefined ? {} : { "x-cron-secret": secret },
    }),
  );

let original: string | undefined;
beforeEach(async () => {
  original = process.env.CRON_SECRET;
  await resetDb();
});
afterEach(() => {
  if (original === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = original;
  useSilentTransport();
  vi.restoreAllMocks();
});

/** More rows than one batch of 50 holds. */
async function queue(n: number) {
  const org = await makeOrg();
  const rows: EnqueueInput[] = Array.from({ length: n }, (_, i) => ({
    kind: "user_invitation",
    content: { subject: "Hello", text: "text", html: "<p>html</p>" },
    toEmail: `person-${i}@example.test`,
    organizationId: org.id,
  }));
  await enqueue(db, rows);
}

describe("cron notifications route", () => {
  test("401 when CRON_SECRET is unset", async () => {
    delete process.env.CRON_SECRET;
    expect((await call("anything")).status).toBe(401);
    expect((await call()).status).toBe(401);
  });

  test("401 when the secret is missing or wrong", async () => {
    process.env.CRON_SECRET = "right-secret";
    expect((await call()).status).toBe(401);
    expect((await call("wrong-secret")).status).toBe(401);
    expect((await call("short")).status).toBe(401);
  });

  test("200 with a dispatched summary for the right secret", async () => {
    process.env.CRON_SECRET = "right-secret";
    const response = await call("right-secret");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      dispatched: { sent: 0, failed: 0, deferred: 0 },
    });
  });

  test("keeps draining while batches make progress", async () => {
    process.env.CRON_SECRET = "right-secret";
    await queue(51);
    const response = await call("right-secret");
    expect(await response.json()).toEqual({
      dispatched: { sent: 51, failed: 0, deferred: 0 },
    });
  });

  test("stops after a batch that sends nothing", async () => {
    process.env.CRON_SECRET = "right-secret";
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const send = vi.fn().mockRejectedValue(new Error("smtp down"));
    setTransportForTests({ name: "down", send });
    await queue(51);

    const response = await call("right-secret");
    // The first batch of 50 all failed: no progress, so the 51st is left for later.
    expect(await response.json()).toEqual({
      dispatched: { sent: 0, failed: 0, deferred: 50 },
    });
    expect(send).toHaveBeenCalledTimes(50);
    const untouched = (await db.select().from(emailNotifications)).filter(
      (r) => r.attempts === 0,
    );
    expect(untouched).toHaveLength(1);
    expect(untouched[0].claimedUntil).toBeNull();
  });
});
