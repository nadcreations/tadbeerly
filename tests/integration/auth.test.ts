import { beforeEach, describe, expect, test, vi } from "vitest";
import { clearCookies, getCookie } from "../setup/nextMocks";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents, organizations, rateLimits } from "@/db/schema";
import { authenticate } from "@/lib/auth";
import { login, logout } from "@/lib/actions/auth";
import { SESSION_COOKIE, createSession } from "@/lib/session";
import { hitRateLimit } from "@/lib/rateLimit";
import { count, makeAgent, makeOrg, makeRequester, resetDb } from "../setup/factories";

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

// after() needs a request scope; run the callback and let tests await it.
const afterTasks: Promise<unknown>[] = [];
vi.mock("next/server", () => ({
  after: (task: () => unknown) => {
    afterTasks.push(Promise.resolve().then(task));
  },
}));
const flushAfter = async () => {
  await Promise.all(afterTasks.splice(0));
};

beforeEach(async () => {
  afterTasks.length = 0;
  await resetDb();
  clearCookies();
});

const form = (email: string, password: string) => {
  const f = new FormData();
  f.set("email", email);
  f.set("password", password);
  return f;
};

describe("authenticate", () => {
  test("login matches email case- and space-insensitively", async () => {
    const org = await makeOrg();
    const u = await makeAgent(org.id, "agent", { email: "alice@meridian.example" });
    const r = await authenticate(" Alice@Meridian.example ", "Password123!");
    expect(r).toEqual({
      status: "ok",
      user: { id: u.id, organizationId: org.id, mfaEnabled: false },
    });
  });

  test("unknown email and wrong password look identical", async () => {
    const org = await makeOrg();
    await makeAgent(org.id, "agent", { email: "a@m.example" });
    const unknown = await authenticate("nobody@m.example", "x");
    const wrong = await authenticate("a@m.example", "x");
    expect(unknown.status).toBe("invalid");
    expect(wrong.status).toBe("invalid");
  });

  test("invalid carries the account identity only when the email matched a user", async () => {
    const org = await makeOrg();
    const u = await makeAgent(org.id, "agent", { email: "a@m.example" });
    const d = await makeAgent(org.id, "agent", { email: "d@m.example", status: "disabled" });
    expect(await authenticate("a@m.example", "x")).toEqual({
      status: "invalid",
      account: { id: u.id, organizationId: org.id },
    });
    expect(await authenticate("d@m.example", "Password123!")).toEqual({
      status: "invalid",
      account: { id: d.id, organizationId: org.id },
    });
    expect(await authenticate("nobody@m.example", "x")).toEqual({ status: "invalid" });
  });

  test("disabled, invited and suspended-organization accounts are invalid", async () => {
    const org = await makeOrg();
    await makeAgent(org.id, "agent", { email: "d@m.example", status: "disabled" });
    await makeAgent(org.id, "agent", { email: "i@m.example", status: "invited" });
    expect((await authenticate("d@m.example", "Password123!")).status).toBe("invalid");
    expect((await authenticate("i@m.example", "Password123!")).status).toBe("invalid");

    const org2 = await makeOrg();
    await makeAgent(org2.id, "agent", { email: "s@m.example" });
    await db
      .update(organizations)
      .set({ status: "suspended" })
      .where(eq(organizations.id, org2.id));
    expect((await authenticate("s@m.example", "Password123!")).status).toBe("invalid");
  });

  test("eleventh failure inside 15 minutes is locked, even with the right password", async () => {
    const org = await makeOrg();
    await makeAgent(org.id, "agent", { email: "a@m.example" });
    for (let i = 0; i < 10; i++) {
      expect((await authenticate("a@m.example", "wrong")).status).toBe("invalid");
    }
    expect(await authenticate("a@m.example", "Password123!")).toEqual({ status: "locked" });
  });

  test("a success clears the failure count", async () => {
    const org = await makeOrg();
    await makeAgent(org.id, "agent", { email: "a@m.example" });
    for (let i = 0; i < 9; i++) await authenticate("a@m.example", "wrong");
    expect((await authenticate("a@m.example", "Password123!")).status).toBe("ok");
    expect(await count(rateLimits)).toBe(0);
  });

  test("unknown emails are rate limited too, case-insensitively", async () => {
    for (let i = 0; i < 10; i++) await authenticate(" Ghost@M.example ", "x");
    expect(await authenticate("ghost@m.example", "x")).toEqual({ status: "locked" });
  });

  test("failures are counted under the normalised email key", async () => {
    await authenticate(" Ghost@M.example ", "x");
    const [row] = await db.select().from(rateLimits);
    expect(row.key).toBe("login:ghost@m.example");
    expect(row.count).toBe(1);
  });
});

describe("login action", () => {
  test("success creates a session, audits auth.login and redirects home", async () => {
    const org = await makeOrg();
    const u = await makeAgent(org.id, "agent", { email: "a@m.example" });
    await expect(login({}, form("a@m.example", "Password123!"))).rejects.toThrow(
      "REDIRECT:/tickets",
    );
    expect(getCookie(SESSION_COOKIE)).toBeTruthy();
    const [ev] = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "auth.login"));
    expect(ev.actorUserId).toBe(u.id);
    expect(ev.organizationId).toBe(org.id);
  });

  test("requesters are redirected to the portal", async () => {
    const org = await makeOrg();
    const r = await makeRequester(org.id, { email: "r@m.example" });
    await expect(login({}, form(r.email, "Password123!"))).rejects.toThrow(/\/portal/);
  });

  test("failure on a real account is audited without the password", async () => {
    const org = await makeOrg();
    const u = await makeAgent(org.id, "agent", { email: "a@m.example" });
    const state = await login({}, form("a@m.example", "hunter2-secret"));
    expect(state).toEqual({ error: "Email or password is incorrect." });
    expect(await count(auditEvents)).toBe(0); // audit is deferred off the response path
    await flushAfter();
    const events = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "auth.login_failed"));
    expect(events).toHaveLength(1);
    expect(events[0].actorUserId).toBe(u.id);
    expect(events[0].organizationId).toBe(org.id);
    expect(JSON.stringify(events[0])).not.toContain("hunter2");
    expect(getCookie(SESSION_COOKIE)).toBeUndefined();
  });

  test("failure for an unknown email gives the same message and no audit row", async () => {
    const state = await login({}, form("nobody@m.example", "x"));
    await flushAfter();
    expect(state.error).toBe("Email or password is incorrect.");
    expect(await count(auditEvents)).toBe(0);
  });

  test("locked shows its own message", async () => {
    const org = await makeOrg();
    await makeAgent(org.id, "agent", { email: "a@m.example" });
    for (let i = 0; i < 10; i++) await hitRateLimit("login:a@m.example", 10, 900);
    const state = await login({}, form("a@m.example", "Password123!"));
    expect(state.error).toBe("Too many attempts. Try again in 15 minutes.");
  });

  test("bad input returns field errors", async () => {
    const state = await login({}, form("not-an-email", ""));
    expect(state.fieldErrors?.email).toBeTruthy();
    expect(state.fieldErrors?.password).toBeTruthy();
  });

  test("a password over 200 characters is a field error and is never hashed", async () => {
    const org = await makeOrg();
    await makeAgent(org.id, "agent", { email: "a@m.example" });
    const state = await login({}, form("a@m.example", "x".repeat(201)));
    expect(state.fieldErrors?.password).toBeTruthy();
    // Refused before authentication: no failure was counted.
    expect(await count(rateLimits)).toBe(0);
  });
});

describe("logout action", () => {
  test("destroys the session and audits auth.logout", async () => {
    const org = await makeOrg();
    const u = await makeAgent(org.id);
    await createSession(u.id);
    await expect(logout()).rejects.toThrow(/\/login/);
    expect(getCookie(SESSION_COOKIE)).toBeUndefined();
    const [ev] = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "auth.logout"));
    expect(ev.actorUserId).toBe(u.id);
  });
});
