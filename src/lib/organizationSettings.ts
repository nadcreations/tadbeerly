import { eq } from "drizzle-orm";
import { db } from "@/db";
import { organizations, users } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { assertCan, type Actor } from "@/lib/authz";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { PERMISSIONS } from "@/lib/permissions";

async function currentOrganization(organizationId: string) {
  const [org] = await db.select().from(organizations).where(eq(organizations.id, organizationId));
  if (!org) throw new NotFoundError("That organization could not be found.");
  return org;
}

/** True only for the case-insensitive name index, not any other unique violation. */
function isDuplicateName(error: unknown): boolean {
  let e: unknown = error;
  while (e && typeof e === "object") {
    const { code, constraint_name: constraint } = e as { code?: string; constraint_name?: string };
    if (code === "23505" && constraint === "organizations_name_lower_idx") return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

export async function updateOrganization(actor: Actor, input: { name: string }): Promise<void> {
  assertCan(actor, PERMISSIONS.ADMIN_CONFIG);
  const name = input.name.trim();
  if (name.length < 2 || name.length > 120) {
    throw new ConflictError("The organization name must be 2 to 120 characters.");
  }
  const org = await currentOrganization(actor.organizationId);
  if (org.name === name) return;

  try {
    await db
      .update(organizations)
      .set({ name, updatedAt: new Date() })
      .where(eq(organizations.id, org.id));
  } catch (error) {
    if (isDuplicateName(error)) {
      throw new ConflictError("Another organization already uses that name.");
    }
    throw error;
  }

  await recordAudit({
    action: "organization.updated",
    summary: `Renamed the organization from ${org.name} to ${name}`,
    organizationId: org.id,
    actorUserId: actor.id,
    entityType: "organization",
    entityId: org.id,
    metadata: { from: org.name, to: name },
  });
}

export async function setOrganizationMfaPolicy(actor: Actor, require: boolean): Promise<void> {
  assertCan(actor, PERMISSIONS.ADMIN_CONFIG);
  const org = await currentOrganization(actor.organizationId);
  if (org.requireMfa === require) return;

  if (require) {
    const [self] = await db
      .select({ mfaEnabled: users.mfaEnabled })
      .from(users)
      .where(eq(users.id, actor.id));
    if (!self?.mfaEnabled) {
      throw new ConflictError(
        "Turn on two-factor authentication for your own account before requiring it for everyone.",
      );
    }
  }

  await db
    .update(organizations)
    .set({ requireMfa: require, updatedAt: new Date() })
    .where(eq(organizations.id, org.id));

  await recordAudit({
    action: "organization.mfa_policy_changed",
    summary: require
      ? "Required two-factor authentication for everyone"
      : "Stopped requiring two-factor authentication",
    organizationId: org.id,
    actorUserId: actor.id,
    entityType: "organization",
    entityId: org.id,
    metadata: { require },
  });
}
