"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { Button, FormError, FormSuccess, Input } from "./ui";
import { RecoveryCodes } from "./RecoveryCodes";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/lib/actions/types";

function Submit({ label, pending }: { label: string; pending: string }) {
  const status = useFormStatus();
  return (
    <Button type="submit" disabled={status.pending}>
      {status.pending ? pending : label}
    </Button>
  );
}

/**
 * A six-digit code form that can hand back recovery codes.
 *
 * Enrolment and regeneration both produce codes that exist only in that one
 * response, so the success payload is prefixed `enrolled:` and unpacked here
 * rather than being rendered as a message.
 */
export function MfaCodeForm({
  action,
  label,
  pendingLabel,
  fieldLabel = "Verification code",
  hint,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  label: string;
  pendingLabel: string;
  fieldLabel?: string;
  hint?: string;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(action, {});
  const router = useRouter();

  const codes =
    state.success?.startsWith("enrolled:")
      ? state.success.slice("enrolled:".length).split(",")
      : null;

  if (codes) {
    // The server action deliberately does not revalidate: a refresh would swap
    // this form out and lose the codes. Refresh only once they are saved.
    return (
      <div className="space-y-3">
        <RecoveryCodes codes={codes} />
        <Button type="button" onClick={() => router.refresh()}>
          I have saved these codes
        </Button>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <FormError message={state.error} />
      <FormSuccess message={state.success} />

      <div>
        <label htmlFor="code" className="block text-[13px] font-medium text-ink-800">
          {fieldLabel}
        </label>
        <Input
          id="code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          required
          placeholder="123456"
          className="mt-1.5 max-w-40 text-center font-mono text-lg tracking-[0.3em]"
        />
        {state.fieldErrors?.code?.length ? (
          <p className="mt-1 text-[12px] text-red-700">
            {state.fieldErrors.code.join(" ")}
          </p>
        ) : null}
        {hint ? <p className="mt-1 text-[12px] text-ink-500">{hint}</p> : null}
      </div>

      <Submit label={label} pending={pendingLabel} />
    </form>
  );
}
