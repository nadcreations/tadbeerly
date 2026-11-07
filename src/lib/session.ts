import { cookies, headers } from "next/headers";
import { createHash, randomBytes } from "node:crypto";
import { eq, lt } from "drizzle-orm";
import { cache } from "react";
import { db } from "@/db";
import { sessions, users, organizations, roles } from "@/db/schema";
import type { Permission } from "@/lib/permissions";

export const SESSION_COOKIE = "tb_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12 hours

/** Sessions are stored hashed, so a database leak does not yield live tokens. */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  const headerList = await headers();
  await db.insert(sessions).values({
    id: hashToken(token),
    userId,
    expiresAt,
    ipAddress: headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: headerList.get("user-agent") ?? null,
  });

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;

  if (token) {
    await db.delete(sessions).where(eq(sessions.id, hashToken(token)));
  }
  cookieStore.delete(SESSION_COOKIE);
}

export type SessionUser = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  jobTitle: string | null;
  kind: "agent" | "requester";
  organizationId: string;
  organizationName: string;
  role: { id: string; key: string; name: string; isLocked: boolean } | null;
  /** Empty when the user has no role (requesters). */
  permissions: Permission[];
  mfaEnabled: boolean;
  /** True when the organization mandates a second factor for everyone. */
  organizationRequiresMfa: boolean;
};

/**
 * Resolves the signed-in user, uncached. Returns null for a missing, unknown
 * or expired session, a non-active user, or a non-active organization, so a
 * disable or suspension takes effect on the very next request.
 */
export async function loadCurrentUser(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      firstName: users.firstName,
      lastName: users.lastName,
      jobTitle: users.jobTitle,
      kind: users.kind,
      organizationId: users.organizationId,
      organizationName: organizations.name,
      roleId: roles.id,
      roleKey: roles.key,
      roleName: roles.name,
      roleIsLocked: roles.isLocked,
      rolePermissions: roles.permissions,
      mfaEnabled: users.mfaEnabled,
      organizationRequiresMfa: organizations.requireMfa,
      status: users.status,
      orgStatus: organizations.status,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .innerJoin(organizations, eq(organizations.id, users.organizationId))
    .leftJoin(roles, eq(roles.id, users.roleId))
    .where(eq(sessions.id, hashToken(token)))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  if (row.expiresAt < new Date()) return null;
  if (row.status !== "active") return null;
  // A suspended organization locks out all of its users at once.
  if (row.orgStatus !== "active") return null;

  return {
    id: row.id,
    email: row.email,
    firstName: row.firstName,
    lastName: row.lastName,
    jobTitle: row.jobTitle,
    kind: row.kind,
    organizationId: row.organizationId,
    organizationName: row.organizationName,
    role: row.roleId
      ? {
          id: row.roleId,
          key: row.roleKey!,
          name: row.roleName!,
          isLocked: row.roleIsLocked!,
        }
      : null,
    permissions: row.roleId ? ((row.rolePermissions ?? []) as Permission[]) : [],
    mfaEnabled: row.mfaEnabled,
    organizationRequiresMfa: row.organizationRequiresMfa,
  };
}

/** Per-request memoised; layouts and pages can each call it without extra queries. */
export const getCurrentUser = cache(loadCurrentUser);

export async function purgeExpiredSessions(): Promise<void> {
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
}

export async function revokeUserSessions(userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}
