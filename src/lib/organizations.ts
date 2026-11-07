import { sql } from "drizzle-orm";
import { db, type Executor } from "@/db";
import { invitations, organizations, roles, users } from "@/db/schema";
import { ConflictError } from "@/lib/errors";
import { normaliseEmail } from "@/lib/format";
import { hashPassword } from "@/lib/password";
import { SYSTEM_ROLE_TEMPLATES } from "@/lib/permissions";
import {
  generateInvitationToken,
  invitationExpiry,
  invitationUrl,
} from "@/lib/tokens";

/** Gives an organization its own copy of every system role template. */
export async function cloneRoleTemplates(exec: Executor, organizationId: string) {
  return exec
    .insert(roles)
    .values(
      SYSTEM_ROLE_TEMPLATES.map((t) => ({
        organizationId,
        key: t.key,
        name: t.name,
        description: t.description,
        permissions: [...t.permissions],
        isSystem: true,
        isLocked: t.isLocked ?? false,
      })),
    )
    .returning();
}

export type CreateOrganizationInput = {
  name: string;
  admin: { email: string; firstName: string; lastName: string; password?: string };
};

/**
 * Creates an organization, its roles and its first administrator in one
 * transaction. Without a password the administrator is invited instead.
 * Not reachable over HTTP: operators run `npm run org:create`.
 */
export async function createOrganizationWithAdmin(
  input: CreateOrganizationInput,
): Promise<{ organizationId: string; adminUserId: string; invitationUrl: string | null }> {
  const name = input.name.trim();
  const email = normaliseEmail(input.admin.email);
  const passwordHash = input.admin.password
    ? await hashPassword(input.admin.password)
    : null;

  return db.transaction(async (tx) => {
    const [dupOrg] = await tx
      .select({ id: organizations.id })
      .from(organizations)
      .where(sql`lower(${organizations.name}) = ${name.toLowerCase()}`);
    if (dupOrg) throw new ConflictError(`${name} is already registered.`);

    const [dupUser] = await tx
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.email}) = ${email}`);
    if (dupUser) throw new ConflictError(`An account already exists for ${email}.`);

    const [org] = await tx.insert(organizations).values({ name }).returning();
    const created = await cloneRoleTemplates(tx, org.id);
    const adminRole = created.find((r) => r.key === "administrator")!;

    const [admin] = await tx
      .insert(users)
      .values({
        organizationId: org.id,
        email,
        passwordHash,
        firstName: input.admin.firstName.trim(),
        lastName: input.admin.lastName.trim(),
        kind: "agent",
        roleId: adminRole.id,
        status: passwordHash ? "active" : "invited",
      })
      .returning({ id: users.id });

    let url: string | null = null;
    if (!passwordHash) {
      const token = generateInvitationToken();
      await tx.insert(invitations).values({
        organizationId: org.id,
        userId: admin.id,
        email,
        roleId: adminRole.id,
        token,
        expiresAt: invitationExpiry(),
        createdByUserId: null,
      });
      url = invitationUrl(token);
    }

    return { organizationId: org.id, adminUserId: admin.id, invitationUrl: url };
  });
}
