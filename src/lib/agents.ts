import { and, eq, sql } from "drizzle-orm";
import { db, type Executor } from "@/db";
import {
  invitations,
  mfaChallenges,
  mfaRecoveryCodes,
  organizations,
  roles,
  users,
} from "@/db/schema";
import { actorRole, assertCan, type Actor } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";
import { dispatchSoon, enqueue } from "@/lib/email/outbox";
import { userInvitationEmail } from "@/lib/email/templates";
import { AuthorizationError, ConflictError, NotFoundError } from "@/lib/errors";
import { fullName, normaliseEmail } from "@/lib/format";
import {
  ADMIN_RESET_TTL_MINUTES,
  issuePasswordReset,
  spendLiveResets,
} from "@/lib/passwordReset";
import { PERMISSIONS } from "@/lib/permissions";
import { revokeUserSessions } from "@/lib/session";
import { generateInvitationToken, invitationExpiry, invitationUrl } from "@/lib/tokens";

/**
 * Agent administration. Every function takes the acting user, requires
 * `admin.users`, and resolves every id it is handed inside the actor's own
 * organization: an id from anywhere else is NotFoundError, never a no-op that
 * happens to touch another tenant.
 */

export const PAGE_SIZE = 50;
export const LAST_ADMINISTRATOR_MESSAGE =
  "An organization must keep at least one active Administrator.";
export const GRANT_ADMINISTRATOR_MESSAGE =
  "Only an Administrator can grant the Administrator role.";
export const ADMINISTRATOR_TARGET_MESSAGE =
  "Only an Administrator can do that to an Administrator.";

/*
 * The Administrator role is protected. Someone who was delegated Manage users
 * can run the team, but must not be able to make anyone an Administrator,
 * themselves included, or take over or lock out an existing one. So only an
 * actor who holds the locked role may:
 *
 *  - grant it (changing someone's role to it, or inviting someone with it);
 *  - change the role of, disable, enable, reset two-step verification for,
 *    issue a password reset for, or resend or withdraw the invitation of
 *    someone who holds it.
 *
 * Whether the actor holds it is read from the database inside the transaction
 * that makes the change, never taken from the Actor object.
 */

async function isAdministrator(exec: Executor, actor: Actor): Promise<boolean> {
  return (await actorRole(exec, actor))?.isLocked ?? false;
}

/**
 * Refuses a non-Administrator acting on someone who holds the locked role.
 * Call it after lockAgent, so the role checked is the role being changed.
 */
async function assertMayManage(
  exec: Executor,
  actor: Actor,
  target: { roleId: string | null },
): Promise<void> {
  if (!target.roleId) return;
  const [role] = await exec
    .select({ isLocked: roles.isLocked })
    .from(roles)
    .where(eq(roles.id, target.roleId));
  if (role?.isLocked && !(await isAdministrator(exec, actor))) {
    throw new AuthorizationError(ADMINISTRATOR_TARGET_MESSAGE);
  }
}

/**
 * The agent `userId` inside the actor's organization, locked for the transaction.
 * NO KEY UPDATE: it blocks other updates and itself, but not the KEY SHARE locks
 * that inserting a referencing row (invitation, notification) takes.
 */
async function lockAgent(exec: Executor, actor: Actor, userId: string) {
  const [target] = await exec
    .select()
    .from(users)
    .where(
      and(
        eq(users.id, userId),
        eq(users.organizationId, actor.organizationId),
        eq(users.kind, "agent"),
      ),
    )
    .for("no key update");
  if (!target) throw new NotFoundError("That person could not be found.");
  return target;
}

/**
 * Throws when `change.userId` is an Administrator (holds the locked role) and
 * no other active Administrator would remain once they stop being one.
 *
 * Call it inside the transaction that makes the change. It first locks the
 * organization's active Administrator rows (FOR NO KEY UPDATE, in id order), so
 * two concurrent demotions queue up: the second one re-reads after the first
 * commits and is refused. Locking in a fixed order, before anything else is
 * locked, keeps the queue from becoming a deadlock; NO KEY UPDATE (rather than
 * FOR UPDATE) leaves the FOR KEY SHARE locks taken by inserts that reference a
 * user (invitations, notifications) free to proceed, so those cannot deadlock
 * against the guard.
 */
export async function assertKeepsAnAdministrator(
  exec: Executor,
  organizationId: string,
  change: { userId: string },
): Promise<void> {
  const active = (await exec.execute(sql`
    select u.id
    from users u
    join roles r on r.id = u.role_id
    where u.organization_id = ${organizationId}
      and u.kind = 'agent'
      and u.status = 'active'
      and r.is_locked
    order by u.id
    for no key update of u
  `)) as unknown as { id: string }[];

  const [target] = await exec
    .select({ isAdministrator: roles.isLocked })
    .from(users)
    .innerJoin(roles, eq(roles.id, users.roleId))
    .where(and(eq(users.id, change.userId), eq(users.organizationId, organizationId)));
  if (!target?.isAdministrator) return;

  if (!active.some((row) => row.id !== change.userId)) {
    throw new ConflictError(LAST_ADMINISTRATOR_MESSAGE);
  }
}

/** A unique violation of the case-insensitive email index, and nothing else. */
function isDuplicateEmailViolation(error: unknown): boolean {
  type Pg = { code?: string; constraint_name?: string };
  const e = error as (Pg & { cause?: Pg }) | null;
  const pg = e?.code ? e : e?.cause;
  return pg?.code === "23505" && pg.constraint_name === "users_email_lower_idx";
}

const DUPLICATE_EMAIL_MESSAGE = "Someone with that email already has an account.";

/* --------------------------------- Invite -------------------------------- */

export type InviteAgentInput = {
  email: string;
  firstName: string;
  lastName: string;
  jobTitle?: string;
  roleId: string;
};

export async function inviteAgent(
  actor: Actor,
  input: InviteAgentInput,
): Promise<{ userId: string; invitationUrl: string }> {
  assertCan(actor, PERMISSIONS.ADMIN_USERS);
  const email = normaliseEmail(input.email);
  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  const jobTitle = input.jobTitle?.trim() || null;

  let created: { userId: string; token: string };
  try {
    created = await db.transaction(async (tx) => {
      const [role] = await tx
        .select({ id: roles.id, isLocked: roles.isLocked })
        .from(roles)
        .where(and(eq(roles.id, input.roleId), eq(roles.organizationId, actor.organizationId)));
      if (!role) throw new NotFoundError("That role could not be found.");
      // The invitation link comes back to the inviter, so this is a grant.
      if (role.isLocked && !(await isAdministrator(tx, actor))) {
        throw new AuthorizationError(GRANT_ADMINISTRATOR_MESSAGE);
      }

      const [duplicate] = await tx
        .select({ id: users.id })
        .from(users)
        .where(sql`lower(${users.email}) = ${email}`);
      if (duplicate) throw new ConflictError(DUPLICATE_EMAIL_MESSAGE);

      const inviter = await inviterOf(tx, actor);

      const [user] = await tx
        .insert(users)
        .values({
          organizationId: actor.organizationId,
          email,
          passwordHash: null,
          firstName,
          lastName,
          jobTitle,
          kind: "agent",
          roleId: role.id,
          status: "invited",
        })
        .returning({ id: users.id });

      const token = await issueInvitation(tx, actor, {
        userId: user.id,
        email,
        roleId: role.id,
        firstName,
        inviter,
      });
      return { userId: user.id, token };
    });
  } catch (error) {
    // Two simultaneous invites for one address: the unique index decides.
    if (isDuplicateEmailViolation(error)) throw new ConflictError(DUPLICATE_EMAIL_MESSAGE);
    throw error;
  }

  await recordAudit({
    action: "agent.invited",
    summary: `${fullName({ firstName, lastName })} (${email}) invited`,
    organizationId: actor.organizationId,
    actorUserId: actor.id,
    entityType: "user",
    entityId: created.userId,
  });
  await dispatchSoon();
  return { userId: created.userId, invitationUrl: invitationUrl(created.token) };
}

async function inviterOf(exec: Executor, actor: Actor) {
  const [inviter] = await exec
    .select({
      firstName: users.firstName,
      lastName: users.lastName,
      organizationName: organizations.name,
    })
    .from(users)
    .innerJoin(organizations, eq(organizations.id, users.organizationId))
    .where(and(eq(users.id, actor.id), eq(users.organizationId, actor.organizationId)));
  if (!inviter) throw new NotFoundError("Your account could not be found.");
  return inviter;
}

/** Writes a pending invitation and its email; returns the token. */
async function issueInvitation(
  exec: Executor,
  actor: Actor,
  invitee: {
    userId: string;
    email: string;
    roleId: string;
    firstName: string;
    inviter: { firstName: string; lastName: string; organizationName: string };
  },
): Promise<string> {
  const token = generateInvitationToken();
  await exec.insert(invitations).values({
    organizationId: actor.organizationId,
    userId: invitee.userId,
    email: invitee.email,
    roleId: invitee.roleId,
    token,
    expiresAt: invitationExpiry(),
    createdByUserId: actor.id,
  });
  await enqueue(exec, [
    {
      kind: "user_invitation",
      content: userInvitationEmail({
        inviterName: fullName(invitee.inviter),
        organizationName: invitee.inviter.organizationName,
        firstName: invitee.firstName,
        url: invitationUrl(token),
      }),
      toEmail: invitee.email,
      organizationId: actor.organizationId,
      recipientUserId: invitee.userId,
      entityType: "user",
      entityId: invitee.userId,
    },
  ]);
  return token;
}

/* ------------------------ Resend and withdraw an invitation ------------------------ */

export async function resendInvitation(
  actor: Actor,
  userId: string,
): Promise<{ invitationUrl: string }> {
  assertCan(actor, PERMISSIONS.ADMIN_USERS);

  const { token, target } = await db.transaction(async (tx) => {
    const target = await lockAgent(tx, actor, userId);
    // The new link comes back to the actor: resending an Administrator's is a grant.
    await assertMayManage(tx, actor, target);
    if (target.status !== "invited") {
      throw new ConflictError("Only people who have not accepted yet can be sent a new invitation.");
    }
    const inviter = await inviterOf(tx, actor);

    await tx
      .update(invitations)
      .set({ status: "revoked", respondedAt: sql`now()` })
      .where(and(eq(invitations.userId, target.id), eq(invitations.status, "pending")));

    const token = await issueInvitation(tx, actor, {
      userId: target.id,
      email: target.email,
      roleId: target.roleId!,
      firstName: target.firstName,
      inviter,
    });
    return { token, target };
  });

  await recordAudit({
    action: "agent.invitation_resent",
    summary: `Invitation resent to ${target.email}`,
    organizationId: actor.organizationId,
    actorUserId: actor.id,
    entityType: "user",
    entityId: target.id,
  });
  await dispatchSoon();
  return { invitationUrl: invitationUrl(token) };
}

export async function withdrawInvitation(actor: Actor, userId: string): Promise<void> {
  assertCan(actor, PERMISSIONS.ADMIN_USERS);

  const email = await db.transaction(async (tx) => {
    await assertKeepsAnAdministrator(tx, actor.organizationId, { userId });
    const target = await lockAgent(tx, actor, userId);
    await assertMayManage(tx, actor, target);
    if (target.status !== "invited" || target.passwordHash !== null) {
      throw new ConflictError("Only people who have not accepted their invitation can be withdrawn.");
    }
    // The invitation rows go with the user (ON DELETE CASCADE).
    await tx.delete(users).where(eq(users.id, target.id));
    return target.email;
  });

  await recordAudit({
    action: "agent.invitation_withdrawn",
    summary: `Invitation to ${email} withdrawn`,
    organizationId: actor.organizationId,
    actorUserId: actor.id,
    entityType: "user",
    entityId: userId,
    metadata: { email },
  });
}

/* ------------------------------- Role and status ------------------------------- */

export async function changeAgentRole(
  actor: Actor,
  userId: string,
  roleId: string,
): Promise<void> {
  assertCan(actor, PERMISSIONS.ADMIN_USERS);

  const change = await db.transaction(async (tx) => {
    const [role] = await tx
      .select()
      .from(roles)
      .where(and(eq(roles.id, roleId), eq(roles.organizationId, actor.organizationId)));
    if (!role) throw new NotFoundError("That role could not be found.");
    if (role.isLocked && !(await isAdministrator(tx, actor))) {
      throw new AuthorizationError(GRANT_ADMINISTRATOR_MESSAGE);
    }

    // Moving someone onto the Administrator role cannot lose an administrator.
    if (!role.isLocked) {
      await assertKeepsAnAdministrator(tx, actor.organizationId, { userId });
    }
    const target = await lockAgent(tx, actor, userId);
    await assertMayManage(tx, actor, target);
    if (target.roleId === role.id) return null;

    const [from] = await tx
      .select({ name: roles.name })
      .from(roles)
      .where(eq(roles.id, target.roleId!));

    await tx
      .update(users)
      .set({ roleId: role.id, updatedAt: new Date() })
      .where(eq(users.id, target.id));
    // An invitation still waiting should grant the role as it now stands.
    await tx
      .update(invitations)
      .set({ roleId: role.id })
      .where(and(eq(invitations.userId, target.id), eq(invitations.status, "pending")));
    return { target, from: from?.name ?? null, to: role.name };
  });
  if (!change) return;

  await recordAudit({
    action: "agent.role_changed",
    summary: `${fullName(change.target)} moved from ${change.from} to ${change.to}`,
    organizationId: actor.organizationId,
    actorUserId: actor.id,
    entityType: "user",
    entityId: userId,
    metadata: { from: change.from, to: change.to },
  });
}

export async function setAgentStatus(
  actor: Actor,
  userId: string,
  status: "active" | "disabled",
): Promise<void> {
  assertCan(actor, PERMISSIONS.ADMIN_USERS);
  if (status === "disabled" && userId === actor.id) {
    throw new ConflictError("You can't disable your own account.");
  }

  const target = await db.transaction(async (tx) => {
    if (status === "disabled") {
      await assertKeepsAnAdministrator(tx, actor.organizationId, { userId });
    }
    const target = await lockAgent(tx, actor, userId);
    await assertMayManage(tx, actor, target);

    if (status === "disabled") {
      if (target.status !== "active") {
        throw new ConflictError("Only active accounts can be disabled.");
      }
      await tx
        .update(users)
        .set({ status: "disabled", updatedAt: new Date() })
        .where(eq(users.id, target.id));
      // Access ends now: no session survives, and no reset link can bring it back.
      await revokeUserSessions(target.id, tx);
      await spendLiveResets(tx, target.id);
    } else {
      if (target.status !== "disabled") {
        throw new ConflictError("Only disabled accounts can be enabled.");
      }
      await tx
        .update(users)
        .set({ status: "active", updatedAt: new Date() })
        .where(eq(users.id, target.id));
    }
    return target;
  });

  await recordAudit({
    action: status === "disabled" ? "agent.disabled" : "agent.enabled",
    summary: `${fullName(target)} ${status === "disabled" ? "disabled" : "enabled"}`,
    organizationId: actor.organizationId,
    actorUserId: actor.id,
    entityType: "user",
    entityId: userId,
  });
}

/* --------------------------------- Credentials --------------------------------- */

/** Returns the link so the administrator can hand it over when email is the problem. */
export async function issueAdminPasswordReset(
  actor: Actor,
  userId: string,
): Promise<{ url: string }> {
  assertCan(actor, PERMISSIONS.ADMIN_USERS);

  // Checked inside the transaction that issues the link, so neither the
  // target nor its role can change in between.
  const { url } = await issuePasswordReset(
    userId,
    actor.id,
    ADMIN_RESET_TTL_MINUTES,
    async (tx) => {
      const target = await lockAgent(tx, actor, userId);
      await assertMayManage(tx, actor, target);
      if (target.status !== "active") {
        throw new ConflictError("Only active accounts can be sent a password reset.");
      }
    },
  );
  return { url };
}

export async function resetAgentMfa(actor: Actor, userId: string): Promise<void> {
  assertCan(actor, PERMISSIONS.ADMIN_USERS);

  const target = await db.transaction(async (tx) => {
    const target = await lockAgent(tx, actor, userId);
    await assertMayManage(tx, actor, target);
    await tx
      .update(users)
      .set({
        mfaEnabled: false,
        mfaSecret: null,
        mfaEnrolledAt: null,
        mfaLastUsedStep: null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, target.id));
    await tx.delete(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.userId, target.id));
    await tx.delete(mfaChallenges).where(eq(mfaChallenges.userId, target.id));
    await revokeUserSessions(target.id, tx);
    return target;
  });

  await recordAudit({
    action: "auth.mfa_reset",
    summary: `Two-step verification reset for ${fullName(target)}`,
    organizationId: actor.organizationId,
    actorUserId: actor.id,
    entityType: "user",
    entityId: userId,
  });
}

/* ---------------------------------- Listing ---------------------------------- */

export type AgentFilters = { q?: string; roleId?: string; status?: string };

const STATUSES = ["invited", "active", "disabled"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function listAgents(
  organizationId: string,
  filters: AgentFilters,
  page: number,
) {
  const conditions = [eq(users.organizationId, organizationId), eq(users.kind, "agent")];
  const q = filters.q?.trim();
  if (q) {
    // Escape LIKE wildcards: the search is for text, not a pattern.
    const pattern = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
    conditions.push(
      sql`((${users.firstName} || ' ' || ${users.lastName}) ilike ${pattern} or ${users.email} ilike ${pattern})`,
    );
  }
  if (filters.roleId && UUID.test(filters.roleId)) {
    conditions.push(eq(users.roleId, filters.roleId));
  }
  const status = STATUSES.find((s) => s === filters.status);
  if (status) conditions.push(eq(users.status, status));
  const where = and(...conditions);

  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(users).where(where);
  // Clamp to the pages that exist, so a stale or hand-edited ?page= never shows an empty list over a non-zero count.
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const current = Math.min(Math.max(1, Math.trunc(page) || 1), lastPage);

  const rows = await db
      .select({
        id: users.id,
        email: users.email,
        firstName: users.firstName,
        lastName: users.lastName,
        jobTitle: users.jobTitle,
        status: users.status,
        roleId: users.roleId,
        roleName: roles.name,
        roleIsLocked: roles.isLocked,
        mfaEnabled: users.mfaEnabled,
        lastLoginAt: users.lastLoginAt,
      })
      .from(users)
      .leftJoin(roles, eq(roles.id, users.roleId))
      .where(where)
      .orderBy(users.lastName, users.firstName, users.id)
      .limit(PAGE_SIZE)
      .offset((current - 1) * PAGE_SIZE);

  return { rows, total, page: current, pageSize: PAGE_SIZE as typeof PAGE_SIZE };
}

/**
 * The organization's roles, for role pickers. `isLocked` marks the
 * Administrator role, which only an Administrator may grant.
 */
export async function listAssignableRoles(organizationId: string) {
  return db
    .select({ id: roles.id, name: roles.name, key: roles.key, isLocked: roles.isLocked })
    .from(roles)
    .where(eq(roles.organizationId, organizationId))
    .orderBy(roles.name);
}
