import { and, asc, eq, sql } from "drizzle-orm";
import { db, type Executor } from "@/db";
import { roles, users } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { actorRole, assertCan, type Actor, type ActorRole } from "@/lib/authz";
import { AuthorizationError, ConflictError, NotFoundError } from "@/lib/errors";
import { ALL_PERMISSIONS, PERMISSIONS } from "@/lib/permissions";

export type Role = typeof roles.$inferSelect;

export const OWN_ROLE_MESSAGE = "You can't change the permissions of your own role.";
export const GRANT_HELD_ONLY_MESSAGE = "You can only grant permissions you have yourself.";

/** Every lookup filters on the organization: a foreign id is simply not found. */
export async function getRole(
  organizationId: string,
  roleId: string,
  exec: Executor = db,
): Promise<Role> {
  const [role] = await exec
    .select()
    .from(roles)
    .where(and(eq(roles.id, roleId), eq(roles.organizationId, organizationId)));
  if (!role) throw new NotFoundError("That role could not be found.");
  return role;
}

/** The organization's roles with how many agents hold each, by name. */
export async function listRoles(organizationId: string): Promise<(Role & { memberCount: number })[]> {
  const rows = await db
    .select({
      role: roles,
      memberCount: sql<number>`count(${users.id})::int`,
    })
    .from(roles)
    .leftJoin(users, and(eq(users.roleId, roles.id), eq(users.kind, "agent")))
    .where(eq(roles.organizationId, organizationId))
    .groupBy(roles.id)
    .orderBy(asc(roles.name));
  return rows.map((r) => ({ ...r.role, memberCount: r.memberCount }));
}

function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

/*
 * Role editors cannot escalate. Someone delegated Manage roles must not be
 * able to widen their own access through it, so:
 *
 *  - nobody edits the permissions of the role they hold (an Administrator's
 *    own role is locked anyway);
 *  - someone who is not an Administrator cannot grant a permission they do not
 *    hold, whether by ticking it on a role or by copying a role that has it.
 *
 * What the actor holds is their role as stored, read inside the transaction.
 */

/** Refuses granting any of `granting` that the actor does not hold. */
function assertMayGrant(mine: ActorRole | null, granting: readonly string[]): void {
  if (mine?.isLocked) return;
  const held = new Set(mine?.permissions ?? []);
  if (granting.some((p) => !held.has(p))) {
    throw new AuthorizationError(GRANT_HELD_ONLY_MESSAGE);
  }
}

export async function createRole(
  actor: Actor,
  input: { name: string; description?: string; copyFromRoleId: string },
): Promise<{ roleId: string }> {
  assertCan(actor, PERMISSIONS.ADMIN_ROLES);
  const name = input.name.trim();
  if (name.length < 2 || name.length > 60) {
    throw new ConflictError("Role names must be 2 to 60 characters.");
  }
  const nameSlug = slug(name);
  if (!nameSlug) throw new ConflictError("Use at least one letter or number in the role name.");
  const key = `custom_${nameSlug}`;
  const description = input.description?.trim() || null;

  let created: { roleId: string; sourceId: string };
  try {
    created = await db.transaction(async (tx) => {
      const source = await getRole(actor.organizationId, input.copyFromRoleId, tx);
      // Every permission the copy starts with is granted by this action.
      assertMayGrant(await actorRole(tx, actor), source.permissions);

      const [existing] = await tx
        .select({ id: roles.id })
        .from(roles)
        .where(and(eq(roles.organizationId, actor.organizationId), eq(roles.key, key)));
      if (existing) throw new ConflictError("A role with that name already exists.");

      const [row] = await tx
        .insert(roles)
        .values({
          organizationId: actor.organizationId,
          key,
          name,
          description,
          permissions: [...source.permissions],
          isSystem: false,
          isLocked: false,
        })
        .returning({ id: roles.id });
      return { roleId: row.id, sourceId: source.id };
    });
  } catch (error) {
    // Lost a race with another create of the same name.
    if (isUniqueViolation(error)) throw new ConflictError("A role with that name already exists.");
    throw error;
  }

  await recordAudit({
    action: "role.created",
    summary: `Created role ${name}`,
    organizationId: actor.organizationId,
    actorUserId: actor.id,
    entityType: "role",
    entityId: created.roleId,
    metadata: { copiedFrom: created.sourceId },
  });
  return { roleId: created.roleId };
}

export async function updateRolePermissions(
  actor: Actor,
  roleId: string,
  permissions: string[],
): Promise<void> {
  assertCan(actor, PERMISSIONS.ADMIN_ROLES);

  const change = await db.transaction(async (tx) => {
    // Locked for the transaction, so "added" is measured against what is replaced.
    const [role] = await tx
      .select()
      .from(roles)
      .where(and(eq(roles.id, roleId), eq(roles.organizationId, actor.organizationId)))
      .for("no key update");
    if (!role) throw new NotFoundError("That role could not be found.");
    if (role.isLocked) {
      throw new ConflictError("The Administrator role always has every permission.");
    }

    const mine = await actorRole(tx, actor);
    if (mine?.id === role.id) throw new ConflictError(OWN_ROLE_MESSAGE);

    const wanted = new Set(permissions);
    const next = ALL_PERMISSIONS.filter((p) => wanted.has(p));
    const before = new Set(role.permissions);
    const added = next.filter((p) => !before.has(p));
    const nextSet = new Set<string>(next);
    const removed = role.permissions.filter((p) => !nextSet.has(p));

    // Keeping or removing a permission the actor lacks is fine; adding one is not.
    assertMayGrant(mine, added);

    await tx
      .update(roles)
      .set({ permissions: next })
      .where(and(eq(roles.id, role.id), eq(roles.organizationId, actor.organizationId)));
    return { role, added, removed };
  });

  await recordAudit({
    action: "role.permissions_updated",
    summary: `Updated permissions for ${change.role.name}`,
    organizationId: actor.organizationId,
    actorUserId: actor.id,
    entityType: "role",
    entityId: change.role.id,
    metadata: { added: change.added, removed: change.removed },
  });
}

function isUniqueViolation(error: unknown): boolean {
  let e: unknown = error;
  while (e && typeof e === "object") {
    if ((e as { code?: string }).code === "23505") return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}
