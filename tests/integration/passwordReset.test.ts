import { beforeEach, describe, expect, test, vi } from "vitest";
import "../setup/nextMocks";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  auditEvents,
  emailNotifications,
  organizations,
  passwordResets,
  rateLimits,
  sessions,
  users,
} from "@/db/schema";
import {
  ADMIN_RESET_TTL_MINUTES,
  SELF_RESET_TTL_MINUTES,
  consumePasswordReset,
  issuePasswordReset,
  requestPasswordReset,
} from "@/lib/passwordReset";
import { requestReset } from "@/lib/actions/passwordReset";
import * as sessionModule from "@/lib/session";
import { createSession } from "@/lib/session";
import { verifyPassword } from "@/lib/password";
import { hitRateLimit } from "@/lib/rateLimit";
import { count, makeAgent, makeOrg, resetDb, userById } from "../setup/factories";

vi.mock("@/lib/session", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/session")>();
  return { ...original, revokeUserSessions: vi.fn(original.revokeUserSessions) };
});
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
// after() callbacks are held, not started, so "nothing has happened yet" is
// deterministic rather than a race against the next query.
const afterTasks: Array<() => unknown> = [];
vi.mock("next/server", () => ({
  after: (task: () => unknown) => {
    afterTasks.push(task);
  },
}));

beforeEach(async () => {
  afterTasks.length = 0;
  await resetDb();
});

const tokenOf = (url: string) => url.split("/reset/")[1];
const GENERIC = "This reset link is invalid or has expired.";

describe("requestPasswordReset", () => {
  test("unknown email enqueues nothing", async () => {
    await requestPasswordReset("ghost@nowhere.example");
    expect(await count(emailNotifications)).toBe(0);
    expect(await count(auditEvents)).toBe(0);
  });

  test("known email (any case) enqueues one reset email and audits", async () => {
    const org = await makeOrg();
    await makeAgent(org.id, "agent", { email: "a@m.example" });
    await requestPasswordReset(" A@M.example ");
    const rows = await db.select().from(emailNotifications);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("password_reset");
    expect(rows[0].toEmail).toBe("a@m.example");
    expect(rows[0].bodyText).toContain("/reset/");
    expect(rows[0].bodyText).toContain("60 minutes");
    const [audit] = await db.select().from(auditEvents);
    expect(audit.action).toBe("auth.password_reset_requested");
  });

  test("a stored address in another case still matches, as every other lookup does", async () => {
    const org = await makeOrg();
    // Written by hand or before normalisation: the unique index is on lower(email).
    await makeAgent(org.id, "agent", { email: "Mixed@Case.example" });
    await requestPasswordReset("mixed@case.example");
    expect(await count(emailNotifications)).toBe(1);
  });

  test("invited, disabled and inactive-organization accounts get nothing", async () => {
    const org = await makeOrg();
    await makeAgent(org.id, "agent", { email: "inv@m.example", status: "invited" });
    await makeAgent(org.id, "agent", { email: "dis@m.example", status: "disabled" });
    const org2 = await makeOrg("Dormant");
    await makeAgent(org2.id, "agent", { email: "dorm@m.example" });
    await db
      .update(organizations)
      .set({ status: "suspended" as never })
      .where(eq(organizations.id, org2.id));
    for (const e of ["inv@m.example", "dis@m.example", "dorm@m.example"]) {
      await requestPasswordReset(e);
    }
    expect(await count(emailNotifications)).toBe(0);
    expect(await count(passwordResets)).toBe(0);
  });

  test("limited to 5 per email per hour, counting unknown emails too", async () => {
    const org = await makeOrg();
    await makeAgent(org.id, "agent", { email: "a@m.example" });
    for (let i = 0; i < 7; i++) await requestPasswordReset("A@m.example");
    expect(await count(emailNotifications)).toBe(5);
    await requestPasswordReset("ghost@x.example");
    const [row] = await db
      .select()
      .from(rateLimits)
      .where(eq(rateLimits.key, "reset:ghost@x.example"));
    expect(row.count).toBe(1);
  });
});

describe("issuePasswordReset", () => {
  test("returns url and expiry; stores only the hash", async () => {
    const org = await makeOrg();
    const u = await makeAgent(org.id);
    const { url, expiresAt } = await issuePasswordReset(u.id, null, SELF_RESET_TTL_MINUTES);
    expect(url).toMatch(/\/reset\/[A-Za-z0-9_-]{43}$/);
    const [row] = await db.select().from(passwordResets);
    expect(row.tokenHash).not.toContain(tokenOf(url));
    expect(Math.round((expiresAt.getTime() - Date.now()) / 60000)).toBe(60);
    expect(await count(auditEvents)).toBe(0);
  });

  test("admin-issued audits issued and uses 24 hours", async () => {
    const org = await makeOrg();
    const admin = await makeAgent(org.id, "administrator");
    const u = await makeAgent(org.id);
    const { expiresAt } = await issuePasswordReset(u.id, admin.id, ADMIN_RESET_TTL_MINUTES);
    expect(Math.round((expiresAt.getTime() - Date.now()) / 3600000)).toBe(24);
    const [audit] = await db.select().from(auditEvents);
    expect(audit.action).toBe("auth.password_reset_issued");
    expect(audit.actorUserId).toBe(admin.id);
  });

  test("a newer link supersedes the older one", async () => {
    const org = await makeOrg();
    const u = await makeAgent(org.id);
    const first = await issuePasswordReset(u.id, null, 60);
    const second = await issuePasswordReset(u.id, null, 60);
    await expect(consumePasswordReset(tokenOf(first.url), "NewPassword123!")).rejects.toThrow(
      GENERIC,
    );
    await expect(consumePasswordReset(tokenOf(second.url), "NewPassword123!")).resolves.toEqual({
      userId: u.id,
    });
  });
});

describe("consumePasswordReset", () => {
  test("works once, sets the password, revokes sessions, clears login limit, audits", async () => {
    const org = await makeOrg();
    const u = await makeAgent(org.id, "agent", { email: "a@m.example" });
    await createSession(u.id);
    await hitRateLimit("login:a@m.example", 10, 900);
    const { url } = await issuePasswordReset(u.id, null, 60);
    await expect(consumePasswordReset(tokenOf(url), "NewPassword123!")).resolves.toEqual({
      userId: u.id,
    });
    expect(await verifyPassword("NewPassword123!", (await userById(u.id)).passwordHash)).toBe(true);
    expect(await count(sessions, eq(sessions.userId, u.id))).toBe(0);
    expect(await count(rateLimits, eq(rateLimits.key, "login:a@m.example"))).toBe(0);
    const audits = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "auth.password_reset_completed"));
    expect(audits).toHaveLength(1);
    await expect(consumePasswordReset(tokenOf(url), "Another12345!")).rejects.toThrow(GENERIC);
  });

  test("sessions are deleted inside the transaction, not after it commits", async () => {
    const org = await makeOrg();
    const u = await makeAgent(org.id, "agent");
    const { url } = await issuePasswordReset(u.id, null, 60);
    const spy = vi.mocked(sessionModule.revokeUserSessions);
    spy.mockClear();
    await consumePasswordReset(tokenOf(url), "NewPassword123!");
    expect(spy).toHaveBeenCalledTimes(1);
    // The second argument is the transaction handle, not the shared connection.
    expect(spy.mock.calls[0][1]).toBeDefined();
    expect(spy.mock.calls[0][1]).not.toBe(db);
  });

  test("parallel submissions: exactly one succeeds", async () => {
    const org = await makeOrg();
    const u = await makeAgent(org.id);
    const { url } = await issuePasswordReset(u.id, null, 60);
    const results = await Promise.allSettled(
      [1, 2, 3, 4].map((i) => consumePasswordReset(tokenOf(url), `NewPassword12${i}!`)),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });

  test("an expired reset is refused", async () => {
    const org = await makeOrg();
    const u = await makeAgent(org.id);
    const { url } = await issuePasswordReset(u.id, null, 60);
    await db.update(passwordResets).set({ expiresAt: new Date(Date.now() - 1000) });
    await expect(consumePasswordReset(tokenOf(url), "NewPassword123!")).rejects.toThrow(GENERIC);
  });

  test("unknown token and short password are refused", async () => {
    await expect(consumePasswordReset("nope", "NewPassword123!")).rejects.toThrow(GENERIC);
    const org = await makeOrg();
    const u = await makeAgent(org.id);
    const { url } = await issuePasswordReset(u.id, null, 60);
    await expect(consumePasswordReset(tokenOf(url), "short")).rejects.toThrow(/at least 10/);
    // the short password did not spend the link
    await expect(consumePasswordReset(tokenOf(url), "NewPassword123!")).resolves.toBeDefined();
  });

  test("a disabled user's link cannot be used", async () => {
    const org = await makeOrg();
    const u = await makeAgent(org.id);
    const { url } = await issuePasswordReset(u.id, null, 60);
    await db.update(users).set({ status: "disabled" }).where(eq(users.id, u.id));
    await expect(consumePasswordReset(tokenOf(url), "NewPassword123!")).rejects.toThrow(GENERIC);
  });
});

describe("requestReset action", () => {
  const form = (email: string) => {
    const f = new FormData();
    f.set("email", email);
    return f;
  };

  test("responds identically for known and unknown; work happens in after()", async () => {
    const org = await makeOrg();
    await makeAgent(org.id, "agent", { email: "a@m.example" });
    const known = await requestReset({}, form("a@m.example"));
    expect(await count(emailNotifications)).toBe(0); // deferred until after()
    const unknown = await requestReset({}, form("ghost@x.example"));
    expect(known).toEqual(unknown);
    expect(known.success).toBe("If an account exists for that address, we've emailed a reset link.");
    await Promise.all(afterTasks.splice(0).map((task) => task()));
    expect(await count(emailNotifications)).toBe(1);
  });

  test("an address over 254 characters is a field error", async () => {
    const r = await requestReset({}, form(`${"a".repeat(250)}@m.example`));
    expect(r.fieldErrors?.email).toBeDefined();
  });

  test("an invalid address is a field error", async () => {
    const r = await requestReset({}, form("not-an-email"));
    expect(r.fieldErrors?.email).toBeDefined();
  });
});
