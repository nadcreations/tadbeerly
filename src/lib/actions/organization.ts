"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { setOrganizationMfaPolicy, updateOrganization } from "@/lib/organizationSettings";
import { requirePermission, type Actor } from "@/lib/authz";
import { PERMISSIONS } from "@/lib/permissions";
import { serviceErrorState } from "./handle";
import { fieldErrorsFrom, type ActionState } from "./types";

/** Thin on purpose: permission, shape, service, revalidate. */
async function run(work: (actor: Actor) => Promise<ActionState>): Promise<ActionState> {
  try {
    const actor = await requirePermission(PERMISSIONS.ADMIN_CONFIG);
    const state = await work(actor);
    revalidatePath("/admin", "layout");
    return state;
  } catch (error) {
    return serviceErrorState(error);
  }
}

const nameSchema = z.object({
  name: z.string().trim().min(2, "Enter at least 2 characters.").max(120, "Use 120 characters or fewer."),
});

export async function updateOrganizationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = nameSchema.safeParse({ name: formData.get("name") });
  return run(async (actor) => {
    if (!parsed.success) {
      return { fieldErrors: fieldErrorsFrom(parsed.error.flatten().fieldErrors) };
    }
    await updateOrganization(actor, parsed.data);
    return { success: "Organization name saved." };
  });
}

const policySchema = z.object({ require: z.enum(["true", "false"]) });

export async function setOrganizationMfaPolicyAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = policySchema.safeParse({ require: formData.get("require") });
  return run(async (actor) => {
    if (!parsed.success) return { error: "Invalid request." };
    const require = parsed.data.require === "true";
    await setOrganizationMfaPolicy(actor, require);
    return {
      success: require
        ? "Two-factor authentication is now required for everyone."
        : "Two-factor authentication is no longer required.",
    };
  });
}
