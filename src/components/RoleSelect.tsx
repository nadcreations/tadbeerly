"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { Select } from "./ui";
import type { ActionState } from "@/lib/actions/types";

function AutoSelect({
  roleId,
  roles,
  disabled,
  refused,
}: {
  roleId: string;
  roles: { id: string; name: string }[];
  disabled?: boolean;
  /** The last action result; a refusal puts the select back on the server value. */
  refused: unknown;
}) {
  const { pending } = useFormStatus();
  const [value, setValue] = useState(roleId);
  // A new server value (after revalidation) is the truth.
  useEffect(() => setValue(roleId), [roleId]);
  // The state object is new for every result, so a repeated refusal reverts again.
  useEffect(() => {
    if (refused) setValue(roleId);
  }, [refused, roleId]);
  return (
    <Select
      name="roleId"
      value={value}
      disabled={disabled || pending}
      aria-label="Role"
      className="!py-1 text-[13px]"
      onChange={(event) => {
        setValue(event.currentTarget.value);
        event.currentTarget.form?.requestSubmit();
      }}
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
      <AutoSelect
        roleId={roleId}
        roles={roles}
        disabled={disabled}
        refused={state.error ? state : null}
      />
      {state.error ? <p className="mt-1 text-[12px] text-red-700">{state.error}</p> : null}
    </form>
  );
}
