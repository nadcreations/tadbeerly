"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import { authenticate } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { fullName, normaliseEmail } from "@/lib/format";
import { createChallenge } from "@/lib/mfa";
import { PASSWORD_MAX_LENGTH, PASSWORD_TOO_LONG_MESSAGE } from "@/lib/passwordReset";
import { completeSignIn } from "@/lib/signIn";
import { destroySession, getCurrentUser } from "@/lib/session";
import { fieldErrorsFrom, type ActionState } from "./types";

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  // No password can be set longer than this, and scrypt should not be handed
  // an arbitrarily large input by an anonymous form.
  password: z
    .string()
    .min(1, "Enter your password.")
    .max(PASSWORD_MAX_LENGTH, PASSWORD_TOO_LONG_MESSAGE),
});

export async function login(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { fieldErrors: fieldErrorsFrom(parsed.error.flatten().fieldErrors) };
  }
  const { email, password } = parsed.data;

  const result = await authenticate(email, password);

  if (result.status === "locked") {
    return { error: "Too many attempts. Try again in 15 minutes." };
  }

  if (result.status === "invalid") {
    // Audit rows need an organization, so an unknown email is not recorded. The
    // write runs after the response so a real account costs no extra time.
    const { account } = result;
    if (account) {
      after(() =>
        recordAudit({
          action: "auth.login_failed",
          summary: `Failed sign-in attempt for ${normaliseEmail(email)}`,
          organizationId: account.organizationId,
          actorUserId: account.id,
          entityType: "user",
          entityId: account.id,
        }),
      );
    }
    return { error: "Email or password is incorrect." };
  }

  const { user } = result;
  if (user.mfaEnabled) {
    // Second factor first: no session exists until the code is verified.
    await createChallenge(user.id);
    redirect("/login/verify");
  }

  return completeSignIn(user);
}

export async function logout(): Promise<void> {
  const user = await getCurrentUser();
  if (user) {
    await recordAudit({
      action: "auth.logout",
      summary: `${fullName(user)} signed out`,
      organizationId: user.organizationId,
      actorUserId: user.id,
      entityType: "user",
      entityId: user.id,
    });
  }
  await destroySession();
  redirect("/login");
}
