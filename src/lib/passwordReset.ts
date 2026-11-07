import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, type Executor } from "@/db";
import { organizations, passwordResets, users } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { enqueue } from "@/lib/email/outbox";
import { appUrl, passwordResetEmail } from "@/lib/email/templates";
import { fullName, normaliseEmail } from "@/lib/format";
import { hashPassword } from "@/lib/password";
import { clearRateLimit, hitRateLimit } from "@/lib/rateLimit";
import { revokeUserSessions } from "@/lib/session";

/**
 * Password resets, administrator-issued and self-service.
 *
 *  - the token is 32 random bytes; only its SHA-256 is stored
 *  - issuing a link supersedes any earlier live one for that person
 *  - redeeming is atomic and single-use, sets the password, and signs the
 *    account out everywhere
 *  - two-step verification is untouched; a reset gets past a password, not MFA
 */

export const ADMIN_RESET_TTL_MINUTES = 1440;
export const SELF_RESET_TTL_MINUTES = 60;

const REQUEST_LIMIT = 5;
const REQUEST_WINDOW_SECONDS = 60 * 60;

export const INVALID_LINK_MESSAGE = "This reset link is invalid or has expired.";
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 200;
export const PASSWORD_TOO_SHORT_MESSAGE = `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
export const PASSWORD_TOO_LONG_MESSAGE = "Password is too long.";

/**
 * The one password rule, shared by reset and invitation acceptance. Throws
 * PasswordResetError (field "password") so callers report it the same way.
 */
export function validateNewPassword(password: string): void {
  if (password.length < PASSWORD_MIN_LENGTH) {
    throw new PasswordResetError(PASSWORD_TOO_SHORT_MESSAGE, "password");
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    throw new PasswordResetError(PASSWORD_TOO_LONG_MESSAGE, "password");
  }
}

/** Thrown by consumePasswordReset; `field` says which input to blame. */
export class PasswordResetError extends Error {
  constructor(
    message: string,
    readonly field: "password" | "link",
  ) {
    super(message);
    this.name = "PasswordResetError";
  }
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function expiryLabel(ttlMinutes: number): string {
  if (ttlMinutes >= 120 && ttlMinutes % 60 === 0) {
    const hours = ttlMinutes / 60;
    return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  }
  return `${ttlMinutes} minutes`;
}

/** Marks every unused reset link for the user as spent. */
export async function spendLiveResets(exec: Executor, userId: string): Promise<void> {
  await exec
    .update(passwordResets)
    .set({ usedAt: new Date() })
    .where(and(eq(passwordResets.userId, userId), isNull(passwordResets.usedAt)));
}

async function issueWith(
  exec: Executor,
  userId: string,
  issuedByUserId: string | null,
  ttlMinutes: number,
): Promise<{ url: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + ttlMinutes * 60_000);

  // Only the newest link works: anything earlier and still unused is spent.
  await spendLiveResets(exec, userId);

  await exec.insert(passwordResets).values({
    userId,
    tokenHash: hashToken(token),
    expiresAt,
    issuedByUserId,
  });

  return { url: appUrl(`/reset/${token}`), expiresAt };
}

/**
 * Issues a reset link. Callers decide who may ask: an administrator action
 * passes its own id (and shows the URL), self-service passes null. Audits
 * `auth.password_reset_issued` when an administrator issued it.
 *
 * `guard` runs first inside the same transaction, so a caller's checks on the
 * target hold for the write; throwing from it issues nothing.
 */
export async function issuePasswordReset(
  userId: string,
  issuedByUserId: string | null,
  ttlMinutes: number,
  guard?: (exec: Executor) => Promise<void>,
): Promise<{ url: string; expiresAt: Date }> {
  const result = await db.transaction(async (tx) => {
    await guard?.(tx);
    return issueWith(tx, userId, issuedByUserId, ttlMinutes);
  });

  if (issuedByUserId) {
    const [target] = await db
      .select({
        organizationId: users.organizationId,
        firstName: users.firstName,
        lastName: users.lastName,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (target) {
      await recordAudit({
        action: "auth.password_reset_issued",
        summary: `Password reset link issued for ${fullName(target)}`,
        organizationId: target.organizationId,
        actorUserId: issuedByUserId,
        entityType: "user",
        entityId: userId,
        metadata: { expiresAt: result.expiresAt.toISOString() },
      });
    }
  }

  return result;
}

/**
 * Self-service request. Resolves the same way whatever the email is, so the
 * caller cannot be used to discover accounts; run it inside `after()` so the
 * timing does not give it away either. Every request counts against the limit,
 * known or not.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const normalised = normaliseEmail(email);
  const { allowed } = await hitRateLimit(
    `reset:${normalised}`,
    REQUEST_LIMIT,
    REQUEST_WINDOW_SECONDS,
  );
  if (!allowed) return;

  const [user] = await db
    .select({
      id: users.id,
      organizationId: users.organizationId,
      email: users.email,
      firstName: users.firstName,
      lastName: users.lastName,
    })
    .from(users)
    .innerJoin(organizations, eq(organizations.id, users.organizationId))
    .where(
      and(
        eq(users.email, normalised),
        eq(users.status, "active"),
        eq(organizations.status, "active"),
      ),
    )
    .limit(1);
  if (!user) return;

  await db.transaction(async (tx) => {
    const { url } = await issueWith(tx, user.id, null, SELF_RESET_TTL_MINUTES);
    await enqueue(tx, [
      {
        kind: "password_reset",
        content: passwordResetEmail({
          firstName: user.firstName,
          url,
          expiresInLabel: expiryLabel(SELF_RESET_TTL_MINUTES),
        }),
        toEmail: user.email,
        toName: fullName(user),
        organizationId: user.organizationId,
        recipientUserId: user.id,
        entityType: "user",
        entityId: user.id,
      },
    ]);
  });

  await recordAudit({
    action: "auth.password_reset_requested",
    summary: `Password reset requested for ${fullName(user)}`,
    organizationId: user.organizationId,
    actorUserId: user.id,
    entityType: "user",
    entityId: user.id,
  });
}

/** Whether a link can still be redeemed, and for whom. For the reset page only. */
export async function loadPasswordReset(
  token: string,
): Promise<{ firstName: string; email: string } | null> {
  const [row] = await db
    .select({ firstName: users.firstName, email: users.email })
    .from(passwordResets)
    .innerJoin(users, eq(users.id, passwordResets.userId))
    .where(
      and(
        eq(passwordResets.tokenHash, hashToken(token)),
        isNull(passwordResets.usedAt),
        sql`${passwordResets.expiresAt} > now()`,
        eq(users.status, "active"),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Spends the link, sets the new password, and signs the account out everywhere
 * (if the password was reset because someone else may have had it, their
 * session must not survive). The spend is one conditional UPDATE, so parallel
 * submissions cannot both succeed.
 */
export async function consumePasswordReset(
  token: string,
  newPassword: string,
): Promise<{ userId: string }> {
  validateNewPassword(newPassword);

  const passwordHash = await hashPassword(newPassword);

  const user = await db.transaction(async (tx) => {
    const spent = await tx
      .update(passwordResets)
      .set({ usedAt: sql`now()` })
      .where(
        and(
          eq(passwordResets.tokenHash, hashToken(token)),
          isNull(passwordResets.usedAt),
          sql`${passwordResets.expiresAt} > now()`,
        ),
      )
      .returning({ userId: passwordResets.userId });
    if (spent.length === 0) throw new PasswordResetError(INVALID_LINK_MESSAGE, "link");

    const [updated] = await tx
      .update(users)
      .set({ passwordHash, updatedAt: new Date() })
      .where(and(eq(users.id, spent[0].userId), eq(users.status, "active")))
      .returning({
        id: users.id,
        email: users.email,
        organizationId: users.organizationId,
        firstName: users.firstName,
        lastName: users.lastName,
      });
    // A disabled account gets no access back; rolling back leaves the link as it was.
    if (!updated) throw new PasswordResetError(INVALID_LINK_MESSAGE, "link");

    // Inside the transaction: the new password and the signed-out state land together.
    await revokeUserSessions(updated.id, tx);
    return updated;
  });

  await clearRateLimit(`login:${normaliseEmail(user.email)}`);
  await recordAudit({
    action: "auth.password_reset_completed",
    summary: `${fullName(user)} set a new password from a reset link`,
    organizationId: user.organizationId,
    actorUserId: user.id,
    entityType: "user",
    entityId: user.id,
  });

  return { userId: user.id };
}
