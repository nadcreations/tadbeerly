"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Select } from "./ui";
import type { ActionState } from "@/lib/actions/types";

function AutoSelect({
  roleId,
  roles,
  disabled,
}: {
  roleId: string;
  roles: { id: string; name: string }[];
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <Select
      name="roleId"
      defaultValue={roleId}
      disabled={disabled || pending}
      aria-label="Role"
      className="!py-1 text-[13px]"
      onChange={(event) => event.currentTarget.form?.requestSubmit()}
    >
      {roles.map((role) => (
        <option key={role.id} value={role.id}>
          {role.name}
        </option>
      ))}
    </Select>
  );
}

/** Changes a person's role as soon as a new one is picked. */
export function RoleSelect({
  action,
  userId,
  roleId,
  roles,
  disabled,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  userId: string;
  roleId: string;
  roles: { id: string; name: string }[];
  disabled?: boolean;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(action, {});

  return (
    <form action={formAction}>
      <input type="hidden" name="userId" value={userId} />
      <AutoSelect roleId={roleId} roles={roles} disabled={disabled} />
      {state.error ? <p className="mt-1 text-[12px] text-red-700">{state.error}</p> : null}
    </form>
  );
}
