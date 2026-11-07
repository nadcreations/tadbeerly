"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
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
  recordFailedAttempt,
  verifyMfaCode,
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

  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({
        mfaEnabled: true,
        mfaEnrolledAt: new Date(),
        mfaLastUsedStep: result.step,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));

    await tx.delete(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.userId, user.id));
    await tx.insert(mfaRecoveryCodes).values(
      codes.map((code) => ({ userId: user.id, codeHash: hashRecoveryCode(code) })),
    );
  });

  await recordAudit({
    action: "auth.mfa_enrolled",
    summary: `${fullName(user)} switched on two-step verification`,
    organizationId: user.organizationId,
    actorUserId: user.id,
    entityType: "user",
    entityId: user.id,
  });

  revalidatePath("/security");
  // The plaintext codes ride back in the action result: this is the only
  // moment they exist outside the user's hands.
  return { success: `enrolled:${codes.join(",")}` };
}

const passwordSchema = z.object({
  password: z.string().min(1, "Enter your password."),
});

export async function disableMfa(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const parsed = passwordSchema.safeParse({ password: formData.get("password") });
  if (!parsed.success) {
    return { fieldErrors: fieldErrorsFrom(parsed.error.flatten().fieldErrors) };
  }

  const rows = await db
    .select({
      passwordHash: users.passwordHash,
      requireMfa: organizations.requireMfa,
    })
    .from(users)
    .innerJoin(organizations, eq(organizations.id, users.organizationId))
    .where(eq(users.id, user.id))
    .limit(1);

  const record = rows[0];
  if (!record) return { error: "Account not found." };

  // Policy beats preference: when the organization mandates MFA, or the user
  // is an Administrator, an individual cannot opt out of it.
  if (record.requireMfa || user.role?.isLocked) {
    return {
      error: record.requireMfa
        ? `${user.organizationName} requires two-step verification, so it cannot be switched off.`
        : "Administrators must keep two-step verification switched on.",
    };
  }

  if (!(await verifyPassword(parsed.data.password, record.passwordHash))) {
    return { fieldErrors: { password: ["That password is not correct."] } };
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

  const verdict = await verifyMfaCode(user.id, parsed.data.code);
  if (verdict !== "ok") {
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
      codes.map((code) => ({ userId: user.id, codeHash: hashRecoveryCode(code) })),
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

  revalidatePath("/security");
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

  // A recovery code is anything that is not six digits: they are 10
  // characters, so the two can never be confused.
  const looksLikeTotp = /^\d{6}$/.test(raw.replace(/\s/g, ""));
  let accepted = false;

  if (looksLikeTotp) {
    accepted = (await verifyMfaCode(challenge.userId, raw)) === "ok";
  } else {
    const matches = await db
      .select({ id: mfaRecoveryCodes.id })
      .from(mfaRecoveryCodes)
      .where(
        and(
          eq(mfaRecoveryCodes.userId, challenge.userId),
          eq(mfaRecoveryCodes.codeHash, hashRecoveryCode(raw)),
          isNull(mfaRecoveryCodes.usedAt),
        ),
      )
      .limit(1);

    if (matches[0]) {
      // Spent atomically before the session exists, so a parallel request
      // carrying the same code cannot also succeed.
      const spent = await db
        .update(mfaRecoveryCodes)
        .set({ usedAt: new Date() })
        .where(and(eq(mfaRecoveryCodes.id, matches[0].id), isNull(mfaRecoveryCodes.usedAt)))
        .returning({ id: mfaRecoveryCodes.id });
      accepted = spent.length > 0;
    }
  }

  if (!accepted) {
    const attempts = await recordFailedAttempt(challenge.challengeId);
    if (attempts >= MAX_ATTEMPTS) {
      await clearChallenge(challenge.challengeId);
      return { error: "Too many attempts. Sign in again." };
    }
    const left = MAX_ATTEMPTS - attempts;
    return {
      fieldErrors: {
        code: [`That code was not accepted. ${left} attempt${left === 1 ? "" : "s"} left.`],
      },
    };
  }

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
