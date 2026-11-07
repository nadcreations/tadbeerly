import { and, eq, sql, type SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { emailNotifications, organizations, roles, users } from "@/db/schema";
import type { Actor } from "@/lib/authz";
import type { Permission } from "@/lib/permissions";
import { cloneRoleTemplates } from "@/lib/organizations";
import { hashPassword } from "@/lib/password";
import { allTableNames } from "./db";

/** Empties every table, so each test starts from nothing. */
export async function resetDb(): Promise<void> {
  const names = await allTableNames();
  if (names.length === 0) return;
  const list = sql.join(
    names.map((n) => sql.identifier(n)),
    sql`, `,
  );
  await db.execute(sql`truncate table ${list} restart identity cascade`);
}

let orgSeq = 0;

/** An organization with its role templates cloned, as in production. */
export async function makeOrg(name?: string) {
  const [org] = await db
    .insert(organizations)
    .values({ name: name ?? `Org ${++orgSeq} ${crypto.randomUUID().slice(0, 8)}` })
    .returning();
  await cloneRoleTemplates(db, org.id);
  return org;
}

export async function roleOf(orgId: string, key: string) {
  const [role] = await db
    .select()
    .from(roles)
    .where(and(eq(roles.organizationId, orgId), eq(roles.key, key)));
  return role;
}

let userSeq = 0;
let passwordHashPromise: Promise<string> | undefined;
const testPasswordHash = () => (passwordHashPromise ??= hashPassword("Password123!"));

/** An active agent with the organization's role of that key; password Password123!. */
export async function makeAgent(
  orgId: string,
  roleKey = "agent",
  overrides: Partial<typeof users.$inferInsert> = {},
) {
  const role = await roleOf(orgId, roleKey);
  const n = ++userSeq;
  const [user] = await db
    .insert(users)
    .values({
      organizationId: orgId,
      email: `agent-${n}@${orgId.slice(0, 8)}.example`,
      passwordHash: await testPasswordHash(),
      firstName: "Agent",
      lastName: `${n}`,
      kind: "agent",
      roleId: role.id,
      status: "active",
      ...overrides,
    })
    .returning();
  permissionsByUser.set(user.id, (role.permissions ?? []) as Permission[]);
  return user;
}

/** An active requester (no role); password Password123!. */
export async function makeRequester(
  orgId: string,
  overrides: Partial<typeof users.$inferInsert> = {},
) {
  const n = ++userSeq;
  const [user] = await db
    .insert(users)
    .values({
      organizationId: orgId,
      email: `requester-${n}@${orgId.slice(0, 8)}.example`,
      passwordHash: await testPasswordHash(),
      firstName: "Requester",
      lastName: `${n}`,
      kind: "requester",
      status: "active",
      ...overrides,
    })
    .returning();
  return user;
}

export async function orgByName(name: string) {
  const [org] = await db
    .select()
    .from(organizations)
    .where(sql`lower(${organizations.name}) = lower(${name})`);
  return org;
}

export async function userById(id: string) {
  const [user] = await db.select().from(users).where(eq(users.id, id));
  return user;
}

export async function count(table: PgTable, where?: SQL): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(table)
    .where(where);
  return row.n;
}

/* ---------------------------- Task 12 helpers ---------------------------- */

const permissionsByUser = new Map<string, Permission[]>();

/**
 * An organization with one active, MFA-enrolled Administrator, so calls behind
 * the MFA gate work without an enrolment dance.
 */
export async function adminFixture(orgName?: string) {
  const org = await makeOrg(orgName);
  const admin = await makeAgent(org.id, "administrator", { mfaEnabled: true });
  return { org, admin };
}

/**
 * The Actor a service expects, for a user made by makeAgent. Permissions are
 * those of the role the user was created with; pass `permissions` to override.
 */
export function actorOf(
  user: { id: string; organizationId: string },
  permissions?: Permission[],
): Actor {
  const resolved = permissions ?? permissionsByUser.get(user.id);
  if (!resolved) throw new Error("actorOf: unknown user; pass permissions explicitly");
  return { id: user.id, organizationId: user.organizationId, permissions: resolved };
}

/** Every queued email, oldest first. */
export async function notifications() {
  return db
    .select()
    .from(emailNotifications)
    .orderBy(emailNotifications.createdAt, emailNotifications.id);
}
