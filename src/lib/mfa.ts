import { cookies, headers } from "next/headers";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { mfaChallenges, mfaRecoveryCodes, users, organizations } from "@/db/schema";
import type { SessionUser } from "@/lib/session";
import { decryptSecret, otpauthUrl, verifyTotp } from "@/lib/totp";

export const MFA_COOKIE = "tb_mfa";

/** Short on purpose: this is a half-authenticated state, not a session. */
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

export const MAX_ATTEMPTS = 5;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Opens the second-factor step after a correct password.
 *
 * No session cookie is issued until the code is verified, so a stolen password
 * alone gets an attacker no further than this screen.
 */
export async function createChallenge(userId: string): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const headerList = await headers();

  // One live challenge per user: starting a new login invalidates any
  // half-finished one left lying around.
  await db.delete(mfaChallenges).where(eq(mfaChallenges.userId, userId));

  await db.insert(mfaChallenges).values({
    id: hashToken(token),
    userId,
    expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
    ipAddress: headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
  });

  const cookieStore = await cookies();
  cookieStore.set(MFA_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: CHALLENGE_TTL_MS / 1000,
  });
}

export type PendingChallenge = {
  challengeId: string;
  userId: string;
  attempts: number;
  email: string;
  firstName: string;
  organizationId: string;
};

/**
 * The live challenge for this browser, or null when it is missing, expired,
 * burnt (MAX_ATTEMPTS failures) or its account or organization is no longer
 * active. The account is re-checked here, not just at password time: one
 * disabled between the two steps must not be able to finish signing in.
 */
export async function getChallenge(): Promise<PendingChallenge | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(MFA_COOKIE)?.value;
  if (!token) return null;

  const rows = await db
    .select({
      challengeId: mfaChallenges.id,
      userId: mfaChallenges.userId,
      attempts: mfaChallenges.attempts,
      expiresAt: mfaChallenges.expiresAt,
      email: users.email,
      firstName: users.firstName,
      organizationId: users.organizationId,
      userStatus: users.status,
      orgStatus: organizations.status,
    })
    .from(mfaChallenges)
    .innerJoin(users, eq(users.id, mfaChallenges.userId))
    .innerJoin(organizations, eq(organizations.id, users.organizationId))
    .where(eq(mfaChallenges.id, hashToken(token)))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  if (row.expiresAt < new Date()) return null;
  if (row.attempts >= MAX_ATTEMPTS) return null;
  if (row.userStatus !== "active" || row.orgStatus !== "active") return null;

  return {
    challengeId: row.challengeId,
    userId: row.userId,
    attempts: row.attempts,
    email: row.email,
    firstName: row.firstName,
    organizationId: row.organizationId,
  };
}

/** Increments and returns the attempt count, so the caller can lock out. */
export async function recordFailedAttempt(challengeId: string): Promise<number> {
  const rows = await db
    .update(mfaChallenges)
    .set({ attempts: sql`${mfaChallenges.attempts} + 1` })
    .where(eq(mfaChallenges.id, challengeId))
    .returning({ attempts: mfaChallenges.attempts });

  return rows[0]?.attempts ?? MAX_ATTEMPTS;
}

export async function clearChallenge(challengeId?: string): Promise<void> {
  if (challengeId) {
    await db.delete(mfaChallenges).where(eq(mfaChallenges.id, challengeId));
  }
  const cookieStore = await cookies();
  cookieStore.delete(MFA_COOKIE);
}

/**
 * Checks a TOTP code for a user and, on success, records the step it matched.
 *
 * The step is written with a compare-and-set, so two parallel requests carrying
 * the same code cannot both succeed: the loser sees "replayed".
 */
export async function verifyMfaCode(
  userId: string,
  code: string,
): Promise<"ok" | "invalid" | "replayed"> {
  const rows = await db
    .select({ mfaSecret: users.mfaSecret, mfaLastUsedStep: users.mfaLastUsedStep })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const row = rows[0];
  const secret = row?.mfaSecret ? decryptSecret(row.mfaSecret) : null;
  if (!row || !secret) return "invalid";

  const result = verifyTotp(secret, code, { lastUsedStep: row.mfaLastUsedStep });
  if (!result.valid) return result.reason === "replayed" ? "replayed" : "invalid";

  const claimed = await db
    .update(users)
    .set({ mfaLastUsedStep: result.step })
    .where(
      and(
        eq(users.id, userId),
        or(isNull(users.mfaLastUsedStep), sql`${users.mfaLastUsedStep} < ${result.step}`),
      ),
    )
    .returning({ id: users.id });
  return claimed.length ? "ok" : "replayed";
}

/**
 * Where an unenrolled user must go before using the app, or null.
 *
 * Enrolment is required when the organization mandates MFA or the user holds
 * the locked Administrator role (design section 11). The security page and the
 * sign-in pages stay open so the requirement can actually be met.
 */
export function mfaGateRedirect(
  user: Pick<SessionUser, "organizationRequiresMfa" | "mfaEnabled" | "role">,
  pathname: string,
): "/security" | null {
  if (user.mfaEnabled) return null;
  if (!user.organizationRequiresMfa && !user.role?.isLocked) return null;
  if (pathname === "/security" || pathname.startsWith("/security/")) return null;
  if (pathname === "/login" || pathname.startsWith("/login/")) return null;
  return "/security";
}

/**
 * The current user's MFA state for the security page.
 *
 * Deliberately not a server action: it would otherwise be callable as an
 * endpoint, and it touches the secret column. The encrypted secret is never
 * returned, only whether one exists.
 */
export async function getMfaStatus(userId: string) {
  const rows = await db
    .select({
      mfaEnabled: users.mfaEnabled,
      hasSecret: sql<boolean>`${users.mfaSecret} is not null`,
      mfaEnrolledAt: users.mfaEnrolledAt,
      requireMfa: organizations.requireMfa,
    })
    .from(users)
    .innerJoin(organizations, eq(organizations.id, users.organizationId))
    .where(eq(users.id, userId))
    .limit(1);

  return rows[0] ?? null;
}

/** The otpauth URI for an in-progress enrolment, or null if none is pending. */
export async function getPendingEnrolment(
  userId: string,
  email: string,
): Promise<{ secret: string; uri: string } | null> {
  const rows = await db
    .select({ mfaSecret: users.mfaSecret, mfaEnabled: users.mfaEnabled })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const row = rows[0];
  if (!row?.mfaSecret || row.mfaEnabled) return null;

  const secret = decryptSecret(row.mfaSecret);
  if (!secret) return null;

  return { secret, uri: otpauthUrl(secret, email) };
}

export async function countUnusedRecoveryCodes(userId: string): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(mfaRecoveryCodes)
    .where(and(eq(mfaRecoveryCodes.userId, userId), isNull(mfaRecoveryCodes.usedAt)));
  return rows[0]?.count ?? 0;
}
