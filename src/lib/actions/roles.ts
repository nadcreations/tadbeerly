"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createRole, updateRolePermissions } from "@/lib/rolesAdmin";
import { requirePermission, type Actor } from "@/lib/authz";
import { PERMISSIONS } from "@/lib/permissions";
import { serviceErrorState } from "./handle";
import { fieldErrorsFrom, type ActionState } from "./types";

/** Thin on purpose: permission, shape, service, revalidate. */
async function run(work: (actor: Actor) => Promise<ActionState>): Promise<ActionState> {
  try {
    const actor = await requirePermission(PERMISSIONS.ADMIN_ROLES);
    const state = await work(actor);
    revalidatePath("/admin/roles", "layout");
    return state;
  } catch (error) {
    return serviceErrorState(error);
  }
}

const id = z.string().uuid();

const permissionsSchema = z.object({
  roleId: id,
  permissions: z.array(z.string().max(100)).max(200),
});

export async function updateRolePermissionsAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = permissionsSchema.safeParse({
    roleId: formData.get("roleId"),
    permissions: formData.getAll("permissions").map(String),
  });
  return run(async (actor) => {
    if (!parsed.success) return { error: "Invalid request." };
    await updateRolePermissions(actor, parsed.data.roleId, parsed.data.permissions);
    return { success: "Permissions saved." };
  });
}

const createSchema = z.object({
  name: z.string().trim().min(2, "Enter at least 2 characters.").max(60, "Use 60 characters or fewer."),
  description: z.string().trim().max(300).optional(),
  copyFromRoleId: id,
});

export async function createRoleAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = createSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") ?? undefined,
    copyFromRoleId: formData.get("copyFromRoleId"),
  });
  return run(async (actor) => {
    if (!parsed.success) {
      return { fieldErrors: fieldErrorsFrom(parsed.error.flatten().fieldErrors) };
    }
    await createRole(actor, parsed.data);
    return { success: `Role ${parsed.data.name} created. Find it in the roles list.` };
  });
}
