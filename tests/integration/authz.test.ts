import { beforeEach, describe, expect, test } from "vitest";
import { clearCookies, setHeaders } from "../setup/nextMocks";
import { db } from "@/db";
import { organizations } from "@/db/schema";
import { eq } from "drizzle-orm";
import { createSession } from "@/lib/session";
import {
  assertCan,
  can,
  homeFor,
  requireAgent,
  requirePagePermission,
  requirePermission,
  requireUser,
} from "@/lib/authz";
import { AuthorizationError } from "@/lib/errors";
import { makeAgent, makeOrg, makeRequester, resetDb } from "../setup/factories";

/** Next encodes the target in the redirect error digest: NEXT_REDIRECT;type;url;status;. */
const redirectTo = (path: string) => ({
  digest: expect.stringMatching(new RegExp(`^NEXT_REDIRECT;[a-z]+;${path};`)),
});

beforeEach(async () => {
  await resetDb();
  clearCookies();
  setHeaders({});
});

describe("MFA gate in requireAgent", () => {
  test("an unenrolled Administrator is redirected to /security, wherever they go", async () => {
    const org = await makeOrg();
    const admin = await makeAgent(org.id, "administrator");
    await createSession(admin.id);
    setHeaders({ "x-tb-pathname": "/tickets" });
    await expect(requireAgent()).rejects.toMatchObject(redirectTo("/security"));
    await expect(requirePermission("admin.users")).rejects.toMatchObject(redirectTo("/security"));
    await expect(requirePagePermission("admin.users")).rejects.toMatchObject(redirectTo("/security"));
    // requireUser (used by the security page and the MFA actions) stays reachable.
    expect((await requireUser()).id).toBe(admin.id);
  });

  test("an enrolled Administrator is not redirected", async () => {
    const org = await makeOrg();
    const admin = await makeAgent(org.id, "administrator", { mfaEnabled: true });
    await createSession(admin.id);
    setHeaders({ "x-tb-pathname": "/tickets" });
    expect((await requireAgent()).id).toBe(admin.id);
    expect((await requirePermission("admin.users")).id).toBe(admin.id);
  });

  test("an unenrolled user under an MFA-requiring organization is gated too", async () => {
    const org = await makeOrg();
    const agent = await makeAgent(org.id, "agent");
    await createSession(agent.id);
    setHeaders({ "x-tb-pathname": "/tickets" });
    expect((await requireAgent()).id).toBe(agent.id);
    await db.update(organizations).set({ requireMfa: true }).where(eq(organizations.id, org.id));
    await expect(requireAgent()).rejects.toMatchObject(redirectTo("/security"));
  });
});

describe("authz", () => {
  test("requireUser redirects anonymous visitors to /login", async () => {
    await expect(requireUser()).rejects.toMatchObject(redirectTo("/login"));
  });

  test("requireAgent sends requesters to the portal", async () => {
    const org = await makeOrg();
    const r = await makeRequester(org.id);
    await createSession(r.id);
    await expect(requireAgent()).rejects.toMatchObject(redirectTo("/portal"));
  });

  test("requireAgent returns an agent and redirects anonymous to /login", async () => {
    await expect(requireAgent()).rejects.toMatchObject(redirectTo("/login"));
    const org = await makeOrg();
    const u = await makeAgent(org.id);
    await createSession(u.id);
    expect((await requireAgent()).id).toBe(u.id);
  });

  test("requirePermission refuses an agent without the key", async () => {
    const org = await makeOrg();
    const u = await makeAgent(org.id, "agent");
    await createSession(u.id);
    await expect(requirePermission("admin.users")).rejects.toBeInstanceOf(AuthorizationError);
  });

  test("requirePermission passes for an administrator", async () => {
    const org = await makeOrg();
    const u = await makeAgent(org.id, "administrator", { mfaEnabled: true });
    await createSession(u.id);
    expect((await requirePermission("admin.users")).id).toBe(u.id);
  });

  test("requirePermission sends requesters to the portal", async () => {
    const org = await makeOrg();
    const r = await makeRequester(org.id);
    await createSession(r.id);
    await expect(requirePermission("admin.users")).rejects.toMatchObject(redirectTo("/portal"));
  });

  test("requirePagePermission renders a 404 without the key", async () => {
    const org = await makeOrg();
    const u = await makeAgent(org.id, "agent");
    await createSession(u.id);
    await expect(requirePagePermission("admin.users")).rejects.toMatchObject({
      digest: "NEXT_HTTP_ERROR_FALLBACK;404",
    });
  });

  test("requirePagePermission returns the user with the key", async () => {
    const org = await makeOrg();
    const u = await makeAgent(org.id, "administrator", { mfaEnabled: true });
    await createSession(u.id);
    expect((await requirePagePermission("admin.users")).id).toBe(u.id);
  });

  test("can, assertCan and homeFor", () => {
    const actor = { id: "x", organizationId: "o", permissions: ["admin.users" as const] };
    expect(can(actor, "admin.users")).toBe(true);
    expect(can(actor, "admin.roles")).toBe(false);
    expect(() => assertCan(actor, "admin.users")).not.toThrow();
    expect(() => assertCan(actor, "admin.roles")).toThrow(AuthorizationError);
    expect(homeFor({ kind: "agent" })).toBe("/tickets");
    expect(homeFor({ kind: "requester" })).toBe("/portal");
  });
});
