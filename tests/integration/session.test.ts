import { beforeEach, describe, expect, test } from "vitest";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { clearCookies, getCookie, setCookie } from "../setup/nextMocks";
import { db } from "@/db";
import { organizations, sessions, users } from "@/db/schema";
import {
  SESSION_COOKIE,
  createSession,
  destroySession,
  loadCurrentUser,
  purgeExpiredSessions,
  revokeUserSessions,
} from "@/lib/session";
import { count, makeAgent, makeOrg, makeRequester, resetDb } from "../setup/factories";

beforeEach(async () => {
  await resetDb();
  clearCookies();
});

describe("sessions", () => {
  test("session resolves the agent with role permissions", async () => {
    const org = await makeOrg();
    const u = await makeAgent(org.id, "administrator");
    await createSession(u.id);
    const me = await loadCurrentUser();
    expect(me?.kind).toBe("agent");
    expect(me?.permissions).toContain("admin.users");
    expect(me?.role?.key).toBe("administrator");
    expect(me?.role?.isLocked).toBeTypeOf("boolean");
    expect(me?.organizationId).toBe(org.id);
  });

  test("requesters resolve with no role and no permissions", async () => {
    const org = await makeOrg();
    const r = await makeRequester(org.id);
    await createSession(r.id);
    const me = await loadCurrentUser();
    expect(me?.kind).toBe("requester");
    expect(me?.role).toBeNull();
    expect(me?.permissions).toEqual([]);
  });

  test("only the SHA-256 of the token is stored", async () => {
    const org = await makeOrg();
    const u = await makeAgent(org.id);
    await createSession(u.id);
    const token = getCookie(SESSION_COOKIE)!;
    expect(token).toBeTruthy();
    const [row] = await db.select().from(sessions);
    expect(row.id).toBe(createHash("sha256").update(token).digest("hex"));
    expect(row.id).not.toBe(token);
    const ttl = row.expiresAt.getTime() - Date.now();
    expect(ttl).toBeGreaterThan(11.9 * 3600_000);
    expect(ttl).toBeLessThanOrEqual(12 * 3600_000);
  });

  test("no cookie or an unknown token gives no user", async () => {
    expect(await loadCurrentUser()).toBeNull();
    setCookie(SESSION_COOKIE, "bogus");
    expect(await loadCurrentUser()).toBeNull();
  });

  test.each(["disabled user", "suspended organization", "expired session"])(
    "no session for %s",
    async (c) => {
      const org = await makeOrg();
      const u = await makeAgent(org.id);
      await createSession(u.id);
      expect(await loadCurrentUser()).not.toBeNull();
      if (c === "disabled user") {
        await db.update(users).set({ status: "disabled" }).where(eq(users.id, u.id));
      } else if (c === "suspended organization") {
        await db
          .update(organizations)
          .set({ status: "suspended" })
          .where(eq(organizations.id, org.id));
      } else {
        await db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) });
      }
      expect(await loadCurrentUser()).toBeNull();
    },
  );

  test("destroySession deletes the row and the cookie", async () => {
    const org = await makeOrg();
    const u = await makeAgent(org.id);
    await createSession(u.id);
    await destroySession();
    expect(await count(sessions)).toBe(0);
    expect(getCookie(SESSION_COOKIE)).toBeUndefined();
    expect(await loadCurrentUser()).toBeNull();
  });

  test("revokeUserSessions removes only that user's sessions", async () => {
    const org = await makeOrg();
    const a = await makeAgent(org.id);
    const b = await makeAgent(org.id);
    await createSession(a.id);
    await createSession(a.id);
    await createSession(b.id);
    await revokeUserSessions(a.id);
    const left = await db.select().from(sessions);
    expect(left).toHaveLength(1);
    expect(left[0].userId).toBe(b.id);
  });

  test("purgeExpiredSessions removes only expired rows", async () => {
    const org = await makeOrg();
    const a = await makeAgent(org.id);
    await createSession(a.id);
    await createSession(a.id);
    const [first] = await db.select().from(sessions);
    await db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(sessions.id, first.id));
    await purgeExpiredSessions();
    expect(await count(sessions)).toBe(1);
  });
});
