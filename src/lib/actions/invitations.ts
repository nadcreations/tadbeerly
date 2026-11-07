"use server";

import { z } from "zod";
import { completeSignIn } from "@/lib/signIn";
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_TOO_LONG_MESSAGE,
  PASSWORD_TOO_SHORT_MESSAGE,
  PasswordResetError,
} from "@/lib/passwordReset";
import { InvitationError, acceptInvitation } from "@/lib/invitations";
import { fieldErrorsFrom, type ActionState } from "./types";

const acceptSchema = z.object({
  token: z.string().min(1),
  password: z
    .string()
    .min(PASSWORD_MIN_LENGTH, PASSWORD_TOO_SHORT_MESSAGE)
    .max(PASSWORD_MAX_LENGTH, PASSWORD_TOO_LONG_MESSAGE),
  confirm: z.string(),
});

/**
 * Public: the token is the credential. Accepting activates the account and
 * signs the person straight in, since they have just proved the link and chosen
 * a password. An invited Administrator is then sent on to enrol two-step
 * verification by the gate, which is intended.
 */
export async function acceptInvitationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = acceptSchema.safeParse({
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

  let accepted: { userId: string; organizationId: string };
  try {
    accepted = await acceptInvitation(parsed.data.token, parsed.data.password);
  } catch (error) {
    if (error instanceof PasswordResetError) {
      return { fieldErrors: { password: [error.message] } };
    }
    if (error instanceof InvitationError) return { error: error.message };
    throw error;
  }

  // Redirects, so it must stay outside the try.
  return completeSignIn({ id: accepted.userId, organizationId: accepted.organizationId });
}
