"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import { dispatchSoon } from "@/lib/email/outbox";
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_TOO_LONG_MESSAGE,
  PASSWORD_TOO_SHORT_MESSAGE,
  PasswordResetError,
  consumePasswordReset,
  requestPasswordReset,
} from "@/lib/passwordReset";
import { fieldErrorsFrom, type ActionState } from "./types";

const requestSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
});

/**
 * Self-service request. The work runs after the response, so the answer and
 * its timing are the same whether or not the account exists.
 */
export async function requestReset(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = requestSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    return { fieldErrors: fieldErrorsFrom(parsed.error.flatten().fieldErrors) };
  }
  const { email } = parsed.data;

  after(async () => {
    try {
      await requestPasswordReset(email);
    } catch (error) {
      console.error("[password-reset] request failed", error);
    }
    await dispatchSoon();
  });

  return {
    success: "If an account exists for that address, we've emailed a reset link.",
  };
}

const completeSchema = z.object({
  token: z.string().min(1),
  password: z
    .string()
    .min(PASSWORD_MIN_LENGTH, PASSWORD_TOO_SHORT_MESSAGE)
    .max(PASSWORD_MAX_LENGTH, PASSWORD_TOO_LONG_MESSAGE),
  confirm: z.string(),
});

/**
 * Ends at the sign-in page rather than signing the person straight in: every
 * session was just revoked, and signing in proves the new password works.
 */
export async function completePasswordReset(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = completeSchema.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) {
    return { fieldErrors: fieldErrorsFrom(parsed.error.flatten().fieldErrors) };
  }
  if (parsed.data.password !== parsed.data.confirm) {
    return { fieldErrors: { confirm: ["The two passwords do not match."] } };
  }

  try {
    await consumePasswordReset(parsed.data.token, parsed.data.password);
  } catch (error) {
    if (error instanceof PasswordResetError) {
      return error.field === "password"
        ? { fieldErrors: { password: [error.message] } }
        : { error: error.message };
    }
    throw error;
  }

  redirect("/login?reset=1");
}
