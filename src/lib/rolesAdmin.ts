import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { roles, users } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { assertCan, type Actor } from "@/lib/authz";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { ALL_PERMISSIONS, PERMISSIONS } from "@/lib/permissions";

export type Role = typeof roles.$inferSelect;

/** Every lookup filters on the organization: a foreign id is simply not found. */
export async function getRole(organizationId: string, roleId: string): Promise<Role> {
  const [role] = await db
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

export async function createRole(
  actor: Actor,
  input: { name: string; description?: string; copyFromRoleId: string },
): Promise<{ roleId: string }> {
  assertCan(actor, PERMISSIONS.ADMIN_ROLES);
  const name = input.name.trim();
  if (name.length < 2 || name.length > 60) {
    throw new ConflictError("Role names must be 2 to 60 characters.");
  }
  const key = `custom_${slug(name)}`;
  const description = input.description?.trim() || null;

  const source = await getRole(actor.organizationId, input.copyFromRoleId);

  const [existing] = await db
    .select({ id: roles.id })
    .from(roles)
    .where(and(eq(roles.organizationId, actor.organizationId), eq(roles.key, key)));
  if (existing) throw new ConflictError("A role with that name already exists.");

  let roleId: string;
  try {
    const [created] = await db
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
    roleId = created.id;
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
    entityId: roleId,
    metadata: { copiedFrom: source.id },
  });
  return { roleId };
}

export async function updateRolePermissions(
  actor: Actor,
  roleId: string,
  permissions: string[],
): Promise<void> {
  assertCan(actor, PERMISSIONS.ADMIN_ROLES);
  const role = await getRole(actor.organizationId, roleId);
  if (role.isLocked) {
    throw new ConflictError("The Administrator role always has every permission.");
  }

  const wanted = new Set(permissions);
  const next = ALL_PERMISSIONS.filter((p) => wanted.has(p));
  const before = new Set(role.permissions);
  const added = next.filter((p) => !before.has(p));
  const removed = role.permissions.filter((p) => !next.includes(p as never));

  await db
    .update(roles)
    .set({ permissions: next })
    .where(and(eq(roles.id, role.id), eq(roles.organizationId, actor.organizationId)));

  await recordAudit({
    action: "role.permissions_updated",
    summary: `Updated permissions for ${role.name}`,
    organizationId: actor.organizationId,
    actorUserId: actor.id,
    entityType: "role",
    entityId: role.id,
    metadata: { added, removed },
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
