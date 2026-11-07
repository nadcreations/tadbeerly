"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { users, organizations, mfaRecoveryCodes } from "@/db/schema";
import { requireUser } from "@/lib/authz";
import { verifyPassword } from "@/lib/password";
import { recordAudit } from "@/lib/audit";
import { fullName } from "@/lib/format";
import {
  generateSecret,
  encryptSecret,
  decryptSecret,
  verifyTotp,
  generateRecoveryCodes,
  hashRecoveryCode,
} from "@/lib/totp";
import {
  getChallenge,
  clearChallenge,
  verifyMfaCode,
  reserveAttempt,
  spendRecoveryCode,
  isMfaLockedOut,
  recordMfaFailure,
  clearMfaFailures,
  TOO_MANY_MFA_FAILURES,
  MAX_ATTEMPTS,
} from "@/lib/mfa";
import { completeSignIn } from "@/lib/signIn";
import { fieldErrorsFrom, type ActionState } from "./types";

/**
 * Issues an unconfirmed secret.
 *
 * It is written to the user row with `mfaEnabled` still false, so a half
 * finished enrolment can never lock anyone out: until a code is verified the
 * secret is inert.
 */
export async function beginMfaEnrolment(
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();

  const rows = await db
    .select({ mfaEnabled: users.mfaEnabled })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);

  if (rows[0]?.mfaEnabled) {
    return { error: "Two-step verification is already switched on." };
  }

  await db
    .update(users)
    .set({ mfaSecret: encryptSecret(generateSecret()), updatedAt: new Date() })
    .where(eq(users.id, user.id));

  await recordAudit({
    action: "auth.mfa_enrolment_started",
    summary: `${fullName(user)} started two-step verification enrolment`,
    organizationId: user.organizationId,
    actorUserId: user.id,
    entityType: "user",
    entityId: user.id,
  });

  revalidatePath("/security");
  return { success: "Scan the code below, then enter a code to finish." };
}

const codeSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Enter the 6-digit code from your app."),
});

/**
 * Confirms enrolment and issues recovery codes.
 *
 * The codes are returned once, here, and only their hashes are kept, so they
 * are shown to the user in the same response and never again.
 */
export async function confirmMfaEnrolment(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const parsed = codeSchema.safeParse({ code: formData.get("code") });
  if (!parsed.success) {
    return { fieldErrors: fieldErrorsFrom(parsed.error.flatten().fieldErrors) };
  }

  const rows = await db
    .select({ mfaEnabled: users.mfaEnabled, mfaSecret: users.mfaSecret })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);

  const record = rows[0];
  if (!record?.mfaSecret) {
    return { error: "Start enrolment first, then enter a code." };
  }
  if (record.mfaEnabled) {
    return { error: "Two-step verification is already switched on." };
  }

  const secret = decryptSecret(record.mfaSecret);
  if (!secret) {
    return {
      error:
        "The stored secret could not be read. Start enrolment again to issue a new one.",
    };
  }

  const result = verifyTotp(secret, parsed.data.code);
  if (!result.valid) {
    return {
      fieldErrors: {
        code: [
          "That code was not accepted. Check your phone's clock is correct and try the next one.",
        ],
      },
    };
  }

  const codes = generateRecoveryCodes();

  const enabled = await db.transaction(async (tx) => {
    // Conditional, so a double submit enables once and the loser touches nothing.
    const flipped = await tx
      .update(users)
      .set({
        mfaEnabled: true,
        mfaEnrolledAt: new Date(),
        mfaLastUsedStep: result.step,
        updatedAt: new Date(),
      })
      .where(and(eq(users.id, user.id), eq(users.mfaEnabled, false)))
      .returning({ id: users.id });
    if (flipped.length === 0) return false;

    await tx.delete(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.userId, user.id));
    await tx.insert(mfaRecoveryCodes).values(
      codes.map((code) => ({ userId: user.id, codeHash: hashRecoveryCode(user.id, code) })),
    );
    return true;
  });
  if (!enabled) return { error: "Two-step verification is already switched on." };

  await recordAudit({
    action: "auth.mfa_enrolled",
    summary: `${fullName(user)} switched on two-step verification`,
    organizationId: user.organizationId,
    actorUserId: user.id,
    entityType: "user",
    entityId: user.id,
  });

  // No revalidatePath here: the refreshed page would switch branch and unmount
  // the form holding the only copy of the codes. The client refreshes once the
  // user confirms they have saved them.
  // The plaintext codes ride back in the action result: this is the only
  // moment they exist outside the user's hands.
  return { success: `enrolled:${codes.join(",")}` };
}

const disableSchema = z.object({
  password: z.string().min(1, "Enter your password."),
  code: z.string().trim().min(1, "Enter a code from your app or a recovery code."),
});

/** A TOTP code is six digits; a recovery code is anything else (10 characters). */
const looksLikeTotp = (raw: string) => /^\d{6}$/.test(raw.replace(/\s/g, ""));

/**
 * Switching MFA off needs the password AND a current second factor (a TOTP code
 * or an unused recovery code): a hijacked session alone must not be able to
 * strip the account's second factor. Failures count against the same per-user
 * limiter as sign-in, so this is not a free guessing oracle either.
 */
export async function disableMfa(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const parsed = disableSchema.safeParse({
    password: formData.get("password"),
    code: formData.get("code"),
  });
  if (!parsed.success) {
    return { fieldErrors: fieldErrorsFrom(parsed.error.flatten().fieldErrors) };
  }

  const rows = await db
    .select({
      passwordHash: users.passwordHash,
      mfaEnabled: users.mfaEnabled,
      requireMfa: organizations.requireMfa,
    })
    .from(users)
    .innerJoin(organizations, eq(organizations.id, users.organizationId))
    .where(eq(users.id, user.id))
    .limit(1);

  const record = rows[0];
  if (!record) return { error: "Account not found." };
  if (!record.mfaEnabled) return { error: "Two-step verification is not switched on." };

  // Policy beats preference: when the organization mandates MFA, or the user
  // is an Administrator, an individual cannot opt out of it.
  if (record.requireMfa || user.role?.isLocked) {
    return {
      error: record.requireMfa
        ? `${user.organizationName} requires two-step verification, so it cannot be switched off.`
        : "Administrators must keep two-step verification switched on.",
    };
  }

  if (await isMfaLockedOut(user.id)) return { error: TOO_MANY_MFA_FAILURES };

  if (!(await verifyPassword(parsed.data.password, record.passwordHash))) {
    await recordMfaFailure(user.id);
    return { fieldErrors: { password: ["That password is not correct."] } };
  }

  const raw = parsed.data.code;
  const factorOk = looksLikeTotp(raw)
    ? (await verifyMfaCode(user.id, raw)) === "ok"
    : await spendRecoveryCode(user.id, raw);
  if (!factorOk) {
    await recordMfaFailure(user.id);
    return { fieldErrors: { code: ["That code was not accepted."] } };
  }

  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({
        mfaEnabled: false,
        mfaSecret: null,
        mfaEnrolledAt: null,
        mfaLastUsedStep: null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));

    await tx.delete(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.userId, user.id));
  });
  await clearMfaFailures(user.id);

  await recordAudit({
    action: "auth.mfa_disabled",
    summary: `${fullName(user)} switched off two-step verification`,
    organizationId: user.organizationId,
    actorUserId: user.id,
    entityType: "user",
    entityId: user.id,
  });

  revalidatePath("/security");
  return { success: "Two-step verification is off." };
}

/** Replaces every recovery code. Requires a live code, proving possession. */
export async function regenerateRecoveryCodes(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const parsed = codeSchema.safeParse({ code: formData.get("code") });
  if (!parsed.success) {
    return { fieldErrors: fieldErrorsFrom(parsed.error.flatten().fieldErrors) };
  }

  const rows = await db
    .select({ mfaEnabled: users.mfaEnabled })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);
  if (!rows[0]?.mfaEnabled) {
    return { error: "Two-step verification is not switched on." };
  }

  if (await isMfaLockedOut(user.id)) return { error: TOO_MANY_MFA_FAILURES };

  const verdict = await verifyMfaCode(user.id, parsed.data.code);
  if (verdict !== "ok") {
    await recordMfaFailure(user.id);
    return {
      fieldErrors: {
        code: [
          verdict === "replayed"
            ? "That code has already been used. Wait for the next one."
            : "That code was not accepted.",
        ],
      },
    };
  }

  const codes = generateRecoveryCodes();

  await db.transaction(async (tx) => {
    await tx.delete(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.userId, user.id));
    await tx.insert(mfaRecoveryCodes).values(
      codes.map((code) => ({ userId: user.id, codeHash: hashRecoveryCode(user.id, code) })),
    );
  });

  await recordAudit({
    action: "auth.recovery_codes_regenerated",
    summary: `${fullName(user)} generated new recovery codes`,
    organizationId: user.organizationId,
    actorUserId: user.id,
    entityType: "user",
    entityId: user.id,
  });

  // No revalidatePath: the codes must stay on screen until acknowledged.
  return { success: `enrolled:${codes.join(",")}` };
}

/* ------------------------- Login: the second step ------------------------ */

/**
 * Completes sign-in with a TOTP code or a recovery code.
 *
 * Only here is a session issued: the password step deliberately leaves the
 * user half-authenticated until this succeeds.
 */
export async function verifyMfaChallenge(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  // getChallenge re-checks the account and organization, so one disabled or
  // suspended since the password step cannot finish signing in.
  const challenge = await getChallenge();
  if (!challenge) {
    return { error: "That verification step expired. Sign in again." };
  }

  const raw = String(formData.get("code") ?? "").trim();
  if (!raw) return { fieldErrors: { code: ["Enter a code."] } };

  // Per-user ceiling first, across every challenge: nothing is evaluated once
  // it is hit, however many fresh challenges the password step opens.
  if (await isMfaLockedOut(challenge.userId)) return { error: TOO_MANY_MFA_FAILURES };

  // Take the attempt atomically before evaluating, so parallel requests cannot
  // all be checked against the same remaining attempt.
  const attempt = await reserveAttempt(challenge.challengeId);
  if (attempt === null) {
    await clearChallenge(challenge.challengeId);
    return { error: "Too many attempts. Sign in again." };
  }

  const accepted = looksLikeTotp(raw)
    ? (await verifyMfaCode(challenge.userId, raw)) === "ok"
    : await spendRecoveryCode(challenge.userId, raw);

  if (!accepted) {
    await recordMfaFailure(challenge.userId);
    if (attempt >= MAX_ATTEMPTS) {
      await clearChallenge(challenge.challengeId);
      return { error: "Too many attempts. Sign in again." };
    }
    const left = MAX_ATTEMPTS - attempt;
    return {
      fieldErrors: {
        code: [`That code was not accepted. ${left} attempt${left === 1 ? "" : "s"} left.`],
      },
    };
  }

  await clearMfaFailures(challenge.userId);
  await clearChallenge(challenge.challengeId);
  await completeSignIn(
    { id: challenge.userId, organizationId: challenge.organizationId },
    { mfa: true },
  );
  return {};
}

export async function cancelMfaChallenge(): Promise<void> {
  const challenge = await getChallenge();
  await clearChallenge(challenge?.challengeId);
  redirect("/login");
}
