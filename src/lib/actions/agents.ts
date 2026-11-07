"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  changeAgentRole,
  inviteAgent,
  issueAdminPasswordReset,
  resendInvitation,
  resetAgentMfa,
  setAgentStatus,
  withdrawInvitation,
} from "@/lib/agents";
import { requirePermission, type Actor } from "@/lib/authz";
import { PERMISSIONS } from "@/lib/permissions";
import { serviceErrorState } from "./handle";
import { fieldErrorsFrom, type ActionState } from "./types";

/**
 * Thin on purpose: permission, shape, service, revalidate. The rules (and the
 * organization scoping) live in src/lib/agents.ts.
 */
async function run(work: (actor: Actor) => Promise<ActionState>): Promise<ActionState> {
  try {
    const actor = await requirePermission(PERMISSIONS.ADMIN_USERS);
    const state = await work(actor);
    revalidatePath("/admin/agents");
    return state;
  } catch (error) {
    return serviceErrorState(error);
  }
}

const id = z.string().uuid();

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().max(254).email("Enter a valid email address."),
  firstName: z.string().trim().min(1, "Enter a first name.").max(100),
  lastName: z.string().trim().min(1, "Enter a last name.").max(100),
  jobTitle: z.string().trim().max(100).optional(),
  roleId: id,
});

export async function inviteAgentAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = inviteSchema.safeParse({
    email: formData.get("email"),
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName"),
    jobTitle: formData.get("jobTitle") ?? undefined,
    roleId: formData.get("roleId"),
  });
  return run(async (actor) => {
    if (!parsed.success) {
      return { fieldErrors: fieldErrorsFrom(parsed.error.flatten().fieldErrors) };
    }
    const { invitationUrl } = await inviteAgent(actor, parsed.data);
    return {
      success: `Invitation sent to ${parsed.data.email}. Share the link yourself if the email is slow.`,
      link: invitationUrl,
    };
  });
}

const userIdSchema = z.object({ userId: id });

export async function resendInvitationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = userIdSchema.safeParse({ userId: formData.get("userId") });
  return run(async (actor) => {
    if (!parsed.success) return { error: "Invalid request." };
    const { invitationUrl } = await resendInvitation(actor, parsed.data.userId);
    return { success: "Invitation resent.", link: invitationUrl };
  });
}

export async function withdrawInvitationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = userIdSchema.safeParse({ userId: formData.get("userId") });
  return run(async (actor) => {
    if (!parsed.success) return { error: "Invalid request." };
    await withdrawInvitation(actor, parsed.data.userId);
    return { success: "Invitation withdrawn." };
  });
}

const roleSchema = z.object({ userId: id, roleId: id });

export async function changeAgentRoleAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = roleSchema.safeParse({
    userId: formData.get("userId"),
    roleId: formData.get("roleId"),
  });
  return run(async (actor) => {
    if (!parsed.success) return { error: "Invalid request." };
    await changeAgentRole(actor, parsed.data.userId, parsed.data.roleId);
    return { success: "Role changed." };
  });
}

const statusSchema = z.object({ userId: id, status: z.enum(["active", "disabled"]) });

export async function setAgentStatusAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = statusSchema.safeParse({
    userId: formData.get("userId"),
    status: formData.get("status"),
  });
  return run(async (actor) => {
    if (!parsed.success) return { error: "Invalid request." };
    await setAgentStatus(actor, parsed.data.userId, parsed.data.status);
    return {
      success: parsed.data.status === "disabled" ? "Account disabled." : "Account enabled.",
    };
  });
}

export async function issueAdminPasswordResetAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = userIdSchema.safeParse({ userId: formData.get("userId") });
  return run(async (actor) => {
    if (!parsed.success) return { error: "Invalid request." };
    const { url } = await issueAdminPasswordReset(actor, parsed.data.userId);
    return { success: "Reset link issued. Copy it now: it is not shown again.", link: url };
  });
}

export async function resetAgentMfaAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = userIdSchema.safeParse({ userId: formData.get("userId") });
  return run(async (actor) => {
    if (!parsed.success) return { error: "Invalid request." };
    await resetAgentMfa(actor, parsed.data.userId);
    return { success: "Two-step verification reset." };
  });
}
