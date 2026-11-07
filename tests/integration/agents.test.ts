import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import "../setup/nextMocks";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  auditEvents,
  emailNotifications,
  invitations,
  mfaChallenges,
  mfaRecoveryCodes,
  passwordResets,
  roles,
  sessions,
  users,
} from "@/db/schema";
import {
  ADMINISTRATOR_TARGET_MESSAGE,
  GRANT_ADMINISTRATOR_MESSAGE,
  assertKeepsAnAdministrator,
  changeAgentRole,
  inviteAgent,
  issueAdminPasswordReset,
  listAgents,
  resendInvitation,
  resetAgentMfa,
  setAgentStatus,
  withdrawInvitation,
} from "@/lib/agents";
import { setTransportForTests, type OutgoingEmail } from "@/lib/email/transport";
import { acceptInvitation } from "@/lib/invitations";
import { createSession } from "@/lib/session";
import { AuthorizationError, ConflictError, NotFoundError } from "@/lib/errors";
import { createOrganizationWithAdmin } from "@/lib/organizations";
import { issuePasswordReset } from "@/lib/passwordReset";
import { hashInvitationToken } from "@/lib/tokens";
import {
  actorOf,
  adminFixture,
  count,
  makeAgent,
  makeOrg,
  makeRequester,
  notifications,
  resetDb,
  roleOf,
  userById,
} from "../setup/factories";
import {
  changeAgentRoleAction,
  inviteAgentAction,
  setAgentStatusAction,
} from "@/lib/actions/agents";
import { clearCookies } from "../setup/nextMocks";
import { useSilentTransport } from "../setup/transport";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const LAST_ADMIN = /at least one active Administrator/;

let sent: OutgoingEmail[] = [];

beforeEach(async () => {
  await resetDb();
  clearCookies();
  sent = [];
  setTransportForTests({ name: "recording", send: async (email) => void sent.push(email) });
});
afterEach(() => useSilentTransport());

const auditActions = async () =>
  (await db.select({ a: auditEvents.action }).from(auditEvents).orderBy(auditEvents.occurredAt)).map(
    (r) => r.a,
  );

describe("inviteAgent", () => {
  test("writes user, invitation and email together", async () => {
    const { org, admin } = await adminFixture();
    const role = await roleOf(org.id, "agent");
    const r = await inviteAgent(actorOf(admin), {
      email: " Dan@Meridian.example ",
      firstName: "Dan",
      lastName: "K",
      roleId: role.id,
    });

    const dan = await userById(r.userId);
    expect(dan).toMatchObject({
      status: "invited",
      kind: "agent",
      passwordHash: null,
      roleId: role.id,
      email: "dan@meridian.example",
      organizationId: org.id,
    });
    expect((await notifications()).map((n) => [n.kind, n.toEmail])).toEqual([
      ["user_invitation", "dan@meridian.example"],
    ]);

    const [inv] = await db.select().from(invitations).where(eq(invitations.userId, r.userId));
    expect(inv).toMatchObject({ status: "pending", createdByUserId: admin.id, organizationId: org.id });
    // The link carries the token; the row holds only its hash.
    const linkToken = r.invitationUrl.split("/invitations/")[1];
    expect(inv.tokenHash).toBe(hashInvitationToken(linkToken));
    expect(inv.tokenHash).not.toBe(linkToken);
    expect(await auditActions()).toEqual(["agent.invited"]);
    // dispatchSoon ran after commit: the invitation went out and the row is marked sent.
    expect(sent.map((m) => m.to)).toEqual(["dan@meridian.example"]);
    expect((await notifications())[0].status).toBe("sent");
  });

  test("a duplicate email in any case is refused, and nothing is written", async () => {
    const { org, admin } = await adminFixture();
    const role = await roleOf(org.id, "agent");
    const input = { firstName: "Dan", lastName: "K", roleId: role.id };
    await inviteAgent(actorOf(admin), { ...input, email: "dan@meridian.example" });

    await expect(
      inviteAgent(actorOf(admin), { ...input, email: " DAN@Meridian.example " }),
    ).rejects.toThrow("Someone with that email already has an account.");
    expect(await count(users)).toBe(2);
    expect(await count(invitations)).toBe(1);
    expect(await count(emailNotifications)).toBe(1);
  });

  test("a duplicate in another organization is refused too", async () => {
    const { org, admin } = await adminFixture();
    const other = await makeOrg("Kestrel");
    await makeAgent(other.id, "agent", { email: "dan@meridian.example" });
    await expect(
      inviteAgent(actorOf(admin), {
        email: "Dan@Meridian.example",
        firstName: "Dan",
        lastName: "K",
        roleId: (await roleOf(org.id, "agent")).id,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  test("a role from another organization is not found, and nothing is written", async () => {
    const { admin } = await adminFixture();
    const other = await makeOrg("Kestrel");
    const before = await count(users);
    await expect(
      inviteAgent(actorOf(admin), {
        email: "dan@meridian.example",
        firstName: "Dan",
        lastName: "K",
        roleId: (await roleOf(other.id, "agent")).id,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(await count(users)).toBe(before);
    expect(await count(invitations)).toBe(0);
  });

  test("an agent without admin.users cannot invite", async () => {
    const { org } = await adminFixture();
    const agent = await makeAgent(org.id, "agent");
    await expect(
      inviteAgent(actorOf(agent), {
        email: "dan@meridian.example",
        firstName: "Dan",
        lastName: "K",
        roleId: (await roleOf(org.id, "agent")).id,
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(await count(invitations)).toBe(0);
  });
});

describe("tenant isolation: foreign ids are not found and change nothing", () => {
  test("changeAgentRole with a role from another organization", async () => {
    const { org, admin } = await adminFixture();
    const other = await makeOrg("Kestrel");
    const foreignRole = await roleOf(other.id, "agent");
    const dan = await makeAgent(org.id, "agent");
    await expect(
      changeAgentRole(actorOf(admin), dan.id, foreignRole.id),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect((await userById(dan.id)).roleId).toBe(dan.roleId);
  });

  test("every service refuses a user from another organization", async () => {
    const { org, admin } = await adminFixture();
    const other = await makeOrg("Kestrel");
    const victim = await makeAgent(other.id, "agent", { mfaEnabled: true, mfaSecret: "s" });
    const invitedVictim = await makeAgent(other.id, "agent", {
      status: "invited",
      passwordHash: null,
    });
    await db.insert(sessions).values({
      id: "victim-session",
      userId: victim.id,
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    const actor = actorOf(admin);
    const myRole = (await roleOf(org.id, "agent")).id;

    await expect(setAgentStatus(actor, victim.id, "disabled")).rejects.toBeInstanceOf(NotFoundError);
    await expect(changeAgentRole(actor, victim.id, myRole)).rejects.toBeInstanceOf(NotFoundError);
    await expect(issueAdminPasswordReset(actor, victim.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(resetAgentMfa(actor, victim.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(resendInvitation(actor, invitedVictim.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(withdrawInvitation(actor, invitedVictim.id)).rejects.toBeInstanceOf(NotFoundError);

    expect(await userById(victim.id)).toMatchObject({
      status: "active",
      roleId: victim.roleId,
      mfaEnabled: true,
      mfaSecret: "s",
    });
    expect(await userById(invitedVictim.id)).toBeDefined();
    expect(await count(passwordResets)).toBe(0);
    expect(await count(sessions, eq(sessions.userId, victim.id))).toBe(1);
    expect(await count(auditEvents)).toBe(0);
  });

  test("a requester in the same organization is not an agent to manage", async () => {
    const { admin, org } = await adminFixture();
    const requester = await makeRequester(org.id);
    await expect(setAgentStatus(actorOf(admin), requester.id, "disabled")).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(issueAdminPasswordReset(actorOf(admin), requester.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect((await userById(requester.id)).status).toBe("active");
  });
});

describe("last active Administrator", () => {
  test("cannot be disabled or demoted", async () => {
    const { org, admin } = await adminFixture();
    // A second admin who is merely invited does not count.
    await makeAgent(org.id, "administrator", { status: "invited", passwordHash: null });
    const other = await makeAgent(org.id, "agent");
    // The actor is someone else with the permission, so only the guard can refuse.
    const actor = actorOf(other, actorOf(admin).permissions);

    await expect(setAgentStatus(actor, admin.id, "disabled")).rejects.toThrow(LAST_ADMIN);
    await expect(
      changeAgentRole(actor, admin.id, (await roleOf(org.id, "agent")).id),
    ).rejects.toThrow(LAST_ADMIN);
    expect(await userById(admin.id)).toMatchObject({ status: "active", roleId: admin.roleId });
  });

  test("an administrator cannot disable themselves", async () => {
    const { org, admin } = await adminFixture();
    await makeAgent(org.id, "administrator");
    await expect(setAgentStatus(actorOf(admin), admin.id, "disabled")).rejects.toThrow(
      "You can't disable your own account.",
    );
  });

  test("the only invited Administrator cannot be withdrawn", async () => {
    const created = await createOrganizationWithAdmin({
      name: "Meridian",
      admin: { email: "alice@meridian.example", firstName: "Alice", lastName: "A" },
    });
    const helper = await makeAgent(created.organizationId, "administrator", { mfaEnabled: true });
    // Helper is an active admin, so Alice may be withdrawn...
    await withdrawInvitation(actorOf(helper), created.adminUserId);
    expect(await count(users, eq(users.id, created.adminUserId))).toBe(0);

    // ...but with nobody active, the only pending Administrator stays.
    const again = await createOrganizationWithAdmin({
      name: "Kestrel",
      admin: { email: "bob@kestrel.example", firstName: "Bob", lastName: "B" },
    });
    const agent = await makeAgent(again.organizationId, "agent");
    await expect(
      withdrawInvitation(actorOf(agent, ["admin.users"]), again.adminUserId),
    ).rejects.toThrow(LAST_ADMIN);
    expect(await count(users, eq(users.id, again.adminUserId))).toBe(1);
  });

  test("with a second active Administrator, the first can be demoted or disabled", async () => {
    const { org, admin } = await adminFixture();
    const second = await makeAgent(org.id, "administrator");
    await changeAgentRole(actorOf(second), admin.id, (await roleOf(org.id, "agent")).id);
    expect((await userById(admin.id)).roleId).not.toBe(admin.roleId);
    await expect(setAgentStatus(actorOf(admin, actorOf(second).permissions), second.id, "disabled")).rejects.toThrow(
      LAST_ADMIN,
    );
  });

  test("two concurrent demotions cannot both pass", async () => {
    const { org, admin: a } = await adminFixture();
    const b = await makeAgent(org.id, "administrator");
    const agentRole = (await roleOf(org.id, "agent")).id;
    const results = await Promise.allSettled([
      changeAgentRole(actorOf(b), a.id, agentRole),
      changeAgentRole(actorOf(a), b.id, agentRole),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(ConflictError);
    expect(rejected.reason.message).toMatch(LAST_ADMIN);
  });

  test("two concurrent disables cannot both pass", async () => {
    const { org, admin: a } = await adminFixture();
    const b = await makeAgent(org.id, "administrator");
    const results = await Promise.allSettled([
      setAgentStatus(actorOf(b), a.id, "disabled"),
      setAgentStatus(actorOf(a), b.id, "disabled"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await count(users, and(eq(users.organizationId, org.id), eq(users.status, "active")))).toBe(1);
  });

  test("assertKeepsAnAdministrator is a no-op for someone who is not an administrator", async () => {
    const { org } = await adminFixture();
    const agent = await makeAgent(org.id, "agent");
    await expect(
      db.transaction((tx) => assertKeepsAnAdministrator(tx, org.id, { userId: agent.id })),
    ).resolves.toBeUndefined();
  });
});

describe("the Administrator role is protected", () => {
  /**
   * An organization with two active Administrators (so the last-Administrator
   * guard never decides) and a Supervisor whose role was given Manage users.
   */
  async function delegate() {
    const { org, admin } = await adminFixture();
    const second = await makeAgent(org.id, "administrator", { mfaEnabled: true });
    const supervisorRole = await roleOf(org.id, "supervisor");
    await db
      .update(roles)
      .set({ permissions: ["admin.users"] })
      .where(eq(roles.id, supervisorRole.id));
    const supervisor = await makeAgent(org.id, "supervisor");
    const dan = await makeAgent(org.id, "agent", { mfaEnabled: true, mfaSecret: "s" });
    return {
      org,
      admin,
      second,
      supervisor,
      dan,
      actor: actorOf(supervisor),
      adminRole: await roleOf(org.id, "administrator"),
      agentRole: await roleOf(org.id, "agent"),
      readOnlyRole: await roleOf(org.id, "read_only"),
    };
  }

  const invite = (roleId: string, email = "new@meridian.example") => ({
    email,
    firstName: "New",
    lastName: "Person",
    roleId,
  });

  test("a delegate with Manage users cannot promote itself or anyone to Administrator", async () => {
    const { actor, supervisor, dan, adminRole } = await delegate();
    await expect(changeAgentRole(actor, supervisor.id, adminRole.id)).rejects.toThrow(
      new AuthorizationError(GRANT_ADMINISTRATOR_MESSAGE),
    );
    await expect(changeAgentRole(actor, dan.id, adminRole.id)).rejects.toThrow(
      GRANT_ADMINISTRATOR_MESSAGE,
    );
    expect((await userById(supervisor.id)).roleId).toBe(supervisor.roleId);
    expect((await userById(dan.id)).roleId).toBe(dan.roleId);
    expect(await count(auditEvents)).toBe(0);
  });

  test("a delegate cannot invite an Administrator", async () => {
    const { actor, adminRole } = await delegate();
    const before = await count(users);
    await expect(inviteAgent(actor, invite(adminRole.id))).rejects.toBeInstanceOf(
      AuthorizationError,
    );
    await expect(inviteAgent(actor, invite(adminRole.id))).rejects.toThrow(
      GRANT_ADMINISTRATOR_MESSAGE,
    );
    expect(await count(users)).toBe(before);
    expect(await count(invitations)).toBe(0);
    expect(await count(emailNotifications)).toBe(0);
  });

  test("a delegate cannot disable, enable, demote, reset 2-step or issue a reset for an Administrator", async () => {
    const { org, admin, actor, agentRole } = await delegate();
    const disabledAdmin = await makeAgent(org.id, "administrator", { status: "disabled" });
    await db.insert(sessions).values({
      id: "admin-session",
      userId: admin.id,
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    const refused = new AuthorizationError(ADMINISTRATOR_TARGET_MESSAGE);

    await expect(setAgentStatus(actor, admin.id, "disabled")).rejects.toThrow(refused);
    await expect(setAgentStatus(actor, disabledAdmin.id, "active")).rejects.toThrow(refused);
    await expect(changeAgentRole(actor, admin.id, agentRole.id)).rejects.toThrow(refused);
    await expect(resetAgentMfa(actor, admin.id)).rejects.toThrow(refused);
    await expect(issueAdminPasswordReset(actor, admin.id)).rejects.toThrow(refused);

    expect(await userById(admin.id)).toMatchObject({
      status: "active",
      roleId: admin.roleId,
      mfaEnabled: true,
    });
    expect((await userById(disabledAdmin.id)).status).toBe("disabled");
    expect(await count(sessions, eq(sessions.userId, admin.id))).toBe(1);
    expect(await count(passwordResets)).toBe(0);
    expect(await count(auditEvents)).toBe(0);
  });

  test("a delegate cannot resend or withdraw an Administrator's invitation", async () => {
    const { admin, actor, adminRole } = await delegate();
    const { userId } = await inviteAgent(actorOf(admin), invite(adminRole.id));
    const refused = new AuthorizationError(ADMINISTRATOR_TARGET_MESSAGE);

    // Resending would hand the delegate a working link to an Administrator account.
    await expect(resendInvitation(actor, userId)).rejects.toThrow(refused);
    await expect(withdrawInvitation(actor, userId)).rejects.toThrow(refused);

    expect(await count(users, eq(users.id, userId))).toBe(1);
    const pending = await db
      .select()
      .from(invitations)
      .where(and(eq(invitations.userId, userId), eq(invitations.status, "pending")));
    expect(pending).toHaveLength(1);
  });

  test("a delegate can still manage agents who are not Administrators", async () => {
    const { actor, dan, agentRole, readOnlyRole } = await delegate();

    await changeAgentRole(actor, dan.id, readOnlyRole.id);
    await resetAgentMfa(actor, dan.id);
    const { url } = await issueAdminPasswordReset(actor, dan.id);
    await setAgentStatus(actor, dan.id, "disabled");
    await setAgentStatus(actor, dan.id, "active");
    const invited = await inviteAgent(actor, invite(agentRole.id));
    await resendInvitation(actor, invited.userId);
    await withdrawInvitation(actor, invited.userId);

    expect(url).toMatch(/\/reset\/.+/);
    expect(await userById(dan.id)).toMatchObject({
      roleId: readOnlyRole.id,
      status: "active",
      mfaEnabled: false,
    });
    expect(await auditActions()).toEqual([
      "agent.role_changed",
      "auth.mfa_reset",
      "auth.password_reset_issued",
      "agent.disabled",
      "agent.enabled",
      "agent.invited",
      "agent.invitation_resent",
      "agent.invitation_withdrawn",
    ]);
  });

  test("an Administrator can do all of it", async () => {
    const { admin, second, dan, adminRole, agentRole } = await delegate();
    const actor = actorOf(admin);

    const invited = await inviteAgent(actor, invite(adminRole.id));
    await resendInvitation(actor, invited.userId);
    await withdrawInvitation(actor, invited.userId);
    await changeAgentRole(actor, dan.id, adminRole.id);
    await resetAgentMfa(actor, second.id);
    await issueAdminPasswordReset(actor, second.id);
    await setAgentStatus(actor, second.id, "disabled");
    await setAgentStatus(actor, second.id, "active");
    await changeAgentRole(actor, second.id, agentRole.id);

    expect((await userById(dan.id)).roleId).toBe(adminRole.id);
    expect(await userById(second.id)).toMatchObject({
      status: "active",
      roleId: agentRole.id,
      mfaEnabled: false,
    });
  });

  test("whether the actor is an Administrator comes from the database, not the actor object", async () => {
    const { org, dan, adminRole } = await delegate();
    const former = await makeAgent(org.id, "administrator", { mfaEnabled: true });
    // Its actor still carries every permission, as a stale or forged one might.
    const stale = actorOf(former);
    await db
      .update(users)
      .set({ roleId: (await roleOf(org.id, "supervisor")).id })
      .where(eq(users.id, former.id));

    await expect(changeAgentRole(stale, dan.id, adminRole.id)).rejects.toThrow(
      GRANT_ADMINISTRATOR_MESSAGE,
    );
    expect((await userById(dan.id)).roleId).toBe(dan.roleId);
  });

  test("the refusal reaches the form as a message", async () => {
    const { supervisor, dan, adminRole } = await delegate();
    clearCookies();
    await createSession(supervisor.id);
    const fd = new FormData();
    fd.set("userId", dan.id);
    fd.set("roleId", adminRole.id);
    const state = await changeAgentRoleAction({}, fd);
    expect(state.error).toBe(GRANT_ADMINISTRATOR_MESSAGE);
    expect((await userById(dan.id)).roleId).toBe(dan.roleId);
  });
});

describe("setAgentStatus", () => {
  test("disabling revokes sessions and spends live password resets, and audits", async () => {
    const { org, admin } = await adminFixture();
    const second = await makeAgent(org.id, "administrator");
    const dan = await makeAgent(org.id, "agent");
    await db.insert(sessions).values({
      id: "dan-session",
      userId: dan.id,
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    await issuePasswordReset(dan.id, admin.id, 60);
    expect(await count(passwordResets, isNull(passwordResets.usedAt))).toBe(1);

    await setAgentStatus(actorOf(second), dan.id, "disabled");

    expect((await userById(dan.id)).status).toBe("disabled");
    expect(await count(sessions, eq(sessions.userId, dan.id))).toBe(0);
    expect(await count(passwordResets, isNull(passwordResets.usedAt))).toBe(0);
    expect(await auditActions()).toContain("agent.disabled");
  });

  test("enabling goes only from disabled to active", async () => {
    const { org, admin } = await adminFixture();
    const dan = await makeAgent(org.id, "agent", { status: "disabled" });
    const eve = await makeAgent(org.id, "agent");
    await setAgentStatus(actorOf(admin), dan.id, "active");
    expect((await userById(dan.id)).status).toBe("active");
    await expect(setAgentStatus(actorOf(admin), eve.id, "active")).rejects.toBeInstanceOf(
      ConflictError,
    );
    const invited = await makeAgent(org.id, "agent", { status: "invited", passwordHash: null });
    await expect(setAgentStatus(actorOf(admin), invited.id, "active")).rejects.toBeInstanceOf(
      ConflictError,
    );
    await expect(setAgentStatus(actorOf(admin), invited.id, "disabled")).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(await auditActions()).toEqual(["agent.enabled"]);
  });

});

describe("changeAgentRole", () => {
  test("changes the role and audits from and to", async () => {
    const { org, admin } = await adminFixture();
    const dan = await makeAgent(org.id, "agent");
    const adminRole = await roleOf(org.id, "administrator");
    await changeAgentRole(actorOf(admin), dan.id, adminRole.id);
    expect((await userById(dan.id)).roleId).toBe(adminRole.id);
    const [event] = await db.select().from(auditEvents).where(eq(auditEvents.action, "agent.role_changed"));
    expect(event.metadata).toEqual({ from: "Agent", to: "Administrator" });
  });
});

describe("invitations: resend and withdraw", () => {
  async function invited() {
    const { org, admin } = await adminFixture();
    const r = await inviteAgent(actorOf(admin), {
      email: "dan@meridian.example",
      firstName: "Dan",
      lastName: "K",
      roleId: (await roleOf(org.id, "agent")).id,
    });
    return { org, admin, ...r };
  }

  test("resend revokes the old token and issues a new one with a new email", async () => {
    const { admin, userId, invitationUrl } = await invited();
    const oldToken = invitationUrl.split("/").pop()!;
    await resendInvitation(actorOf(admin), userId);

    const rows = await db.select().from(invitations).where(eq(invitations.userId, userId));
    const oldHash = hashInvitationToken(oldToken);
    expect(rows.find((r) => r.tokenHash === oldHash)?.status).toBe("revoked");
    const fresh = rows.filter((r) => r.status === "pending");
    expect(fresh).toHaveLength(1);
    expect(fresh[0].tokenHash).not.toBe(oldHash);
    expect((await notifications()).map((n) => n.kind)).toEqual(["user_invitation", "user_invitation"]);
    expect(await auditActions()).toEqual(["agent.invited", "agent.invitation_resent"]);
  });

  test("after a resend the old link is refused and the new one works", async () => {
    const { admin, userId, invitationUrl } = await invited();
    const oldToken = invitationUrl.split("/").pop()!;
    const { invitationUrl: fresh } = await resendInvitation(actorOf(admin), userId);
    await expect(acceptInvitation(oldToken, "Password123!")).rejects.toThrow("This invitation is invalid or has expired.");
    await expect(acceptInvitation(fresh.split("/").pop()!, "Password123!")).resolves.toMatchObject({ userId });
  });

  test("resend is only for invited users", async () => {
    const { org, admin } = await adminFixture();
    const active = await makeAgent(org.id, "agent");
    await expect(resendInvitation(actorOf(admin), active.id)).rejects.toBeInstanceOf(ConflictError);
  });

  test("withdraw deletes the user and the invitation, and audits the email", async () => {
    const { admin, userId } = await invited();
    await withdrawInvitation(actorOf(admin), userId);
    expect(await count(users, eq(users.id, userId))).toBe(0);
    expect(await count(invitations)).toBe(0);
    const [event] = await db.select().from(auditEvents).where(eq(auditEvents.action, "agent.invitation_withdrawn"));
    expect(event.metadata).toEqual({ email: "dan@meridian.example" });
  });

  test("withdraw refuses someone who has been activated", async () => {
    const { org, admin } = await adminFixture();
    const active = await makeAgent(org.id, "agent");
    await expect(withdrawInvitation(actorOf(admin), active.id)).rejects.toBeInstanceOf(ConflictError);
    expect(await count(users, eq(users.id, active.id))).toBe(1);
  });
});

describe("issueAdminPasswordReset", () => {
  test("returns a url for an active agent and audits", async () => {
    const { org, admin } = await adminFixture();
    const dan = await makeAgent(org.id, "agent");
    const { url } = await issueAdminPasswordReset(actorOf(admin), dan.id);
    expect(url).toMatch(/\/reset\/.+/);
    expect(await count(passwordResets)).toBe(1);
    expect(await auditActions()).toEqual(["auth.password_reset_issued"]);
  });

  test("refuses a target who is not active", async () => {
    const { org, admin } = await adminFixture();
    const disabled = await makeAgent(org.id, "agent", { status: "disabled" });
    const invited = await makeAgent(org.id, "agent", { status: "invited", passwordHash: null });
    await expect(issueAdminPasswordReset(actorOf(admin), disabled.id)).rejects.toBeInstanceOf(
      ConflictError,
    );
    await expect(issueAdminPasswordReset(actorOf(admin), invited.id)).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(await count(passwordResets)).toBe(0);
  });

  test("requires admin.users", async () => {
    const { org } = await adminFixture();
    const dan = await makeAgent(org.id, "agent");
    await expect(issueAdminPasswordReset(actorOf(dan), dan.id)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });
});

describe("resetAgentMfa", () => {
  test("clears the secret, codes and challenges, revokes sessions, audits", async () => {
    const { org, admin } = await adminFixture();
    const dan = await makeAgent(org.id, "agent", {
      mfaEnabled: true,
      mfaSecret: "secret",
      mfaEnrolledAt: new Date(),
      mfaLastUsedStep: 5,
    });
    await db.insert(mfaRecoveryCodes).values({ userId: dan.id, codeHash: "h" });
    await db.insert(mfaChallenges).values({
      id: "c1",
      userId: dan.id,
      expiresAt: new Date(Date.now() + 60_000),
    });
    await db.insert(sessions).values({
      id: "s1",
      userId: dan.id,
      expiresAt: new Date(Date.now() + 3_600_000),
    });

    await resetAgentMfa(actorOf(admin), dan.id);

    expect(await userById(dan.id)).toMatchObject({
      mfaEnabled: false,
      mfaSecret: null,
      mfaEnrolledAt: null,
      mfaLastUsedStep: null,
    });
    expect(await count(mfaRecoveryCodes)).toBe(0);
    expect(await count(mfaChallenges)).toBe(0);
    expect(await count(sessions, eq(sessions.userId, dan.id))).toBe(0);
    expect(await auditActions()).toEqual(["auth.mfa_reset"]);
  });
});

describe("listAgents", () => {
  test("is scoped to the organization, filters, and pages", async () => {
    const { org, admin } = await adminFixture();
    const other = await makeOrg("Kestrel");
    await makeAgent(other.id, "agent", { firstName: "Zed" });
    await makeRequester(org.id);
    await makeAgent(org.id, "agent", { firstName: "Dana", lastName: "Fox", email: "dana@m.example" });
    await makeAgent(org.id, "agent", { status: "disabled", firstName: "Dora" });

    const all = await listAgents(org.id, {}, 1);
    expect(all).toMatchObject({ total: 3, page: 1, pageSize: 50 });
    expect(all.rows.every((r) => typeof r.email === "string")).toBe(true);

    expect((await listAgents(org.id, { q: "FOX" }, 1)).rows.map((r) => r.firstName)).toEqual(["Dana"]);
    expect((await listAgents(org.id, { q: "dana@m" }, 1)).total).toBe(1);
    expect((await listAgents(org.id, { q: "%" }, 1)).total).toBe(0);
    expect((await listAgents(org.id, { status: "disabled" }, 1)).rows.map((r) => r.firstName)).toEqual(["Dora"]);
    expect((await listAgents(org.id, { roleId: admin.roleId! }, 1)).total).toBe(1);
    expect((await listAgents(org.id, { status: "nonsense" }, 1)).total).toBe(3);
    // Out of range clamps to the last page (here page 1), keeping the count honest.
    const beyond = await listAgents(org.id, {}, 9);
    expect(beyond).toMatchObject({ page: 1, total: 3 });
    expect(beyond.rows).toHaveLength(3);
    expect((await listAgents(org.id, { status: "disabled" }, 9))).toMatchObject({ page: 1, total: 1 });
    expect((await listAgents(org.id, {}, 0)).page).toBe(1);
    expect((await listAgents(org.id, {}, Number.NaN)).page).toBe(1);
  });
});

describe("listAgents search", () => {
  test("an underscore matches literally", async () => {
    const { org } = await adminFixture();
    await makeAgent(org.id, "agent", { firstName: "a_b", email: "one@m.example" });
    await makeAgent(org.id, "agent", { firstName: "axb", email: "two@m.example" });
    expect((await listAgents(org.id, { q: "a_b" }, 1)).rows.map((r) => r.firstName)).toEqual(["a_b"]);
  });

  test("paging clamps to the last page of a larger set", async () => {
    const { org } = await adminFixture();
    for (let i = 0; i < 51; i++) await makeAgent(org.id, "agent", { passwordHash: null, status: "disabled" });
    const last = await listAgents(org.id, { status: "disabled" }, 99);
    expect(last).toMatchObject({ page: 2, total: 51 });
    expect(last.rows).toHaveLength(1);
  });
});

describe("thin actions", () => {
  async function signedIn(roleKey: string, mfa = true) {
    const org = await makeOrg();
    const user = await makeAgent(org.id, roleKey, { mfaEnabled: mfa });
    clearCookies();
    await createSession(user.id);
    return { org, user };
  }

  test("an agent without admin.users gets a message, and nothing changes", async () => {
    const { org } = await signedIn("agent");
    const fd = new FormData();
    fd.set("email", "dan@meridian.example");
    fd.set("firstName", "Dan");
    fd.set("lastName", "K");
    fd.set("roleId", (await roleOf(org.id, "agent")).id);
    const state = await inviteAgentAction({}, fd);
    expect(state.error).toMatch(/permission/i);
    expect(await count(invitations)).toBe(0);
  });

  test("a conflict becomes an ActionState message", async () => {
    const { user } = await signedIn("administrator");
    const fd = new FormData();
    fd.set("userId", user.id);
    fd.set("status", "disabled");
    const state = await setAgentStatusAction({}, fd);
    expect(state.error).toBe("You can't disable your own account.");
  });

  test("a foreign id becomes a message, not a crash", async () => {
    await signedIn("administrator");
    const stranger = await makeAgent((await makeOrg("Kestrel")).id, "agent");
    const fd = new FormData();
    fd.set("userId", stranger.id);
    fd.set("status", "disabled");
    const state = await setAgentStatusAction({}, fd);
    expect(state.error).toBeTruthy();
    expect((await userById(stranger.id)).status).toBe("active");
  });

  test("invalid input is reported as field errors", async () => {
    await signedIn("administrator");
    const fd = new FormData();
    fd.set("email", "not-an-email");
    fd.set("firstName", "");
    fd.set("lastName", "K");
    fd.set("roleId", "nope");
    const state = await inviteAgentAction({}, fd);
    expect(state.fieldErrors).toMatchObject({ email: expect.any(Array), firstName: expect.any(Array) });
  });
});

