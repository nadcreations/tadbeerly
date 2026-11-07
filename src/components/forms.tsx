"use client";

import {
  createContext,
  useActionState,
  useContext,
  type ComponentProps,
  type ReactNode,
} from "react";
import { useFormStatus } from "react-dom";
import { Button, FormError, FormSuccess } from "./ui";
import type { ActionState } from "@/lib/actions/types";

type ServerAction = (
  prev: ActionState,
  formData: FormData,
) => Promise<ActionState>;

const FieldErrorContext = createContext<Record<string, string[]>>({});

/**
 * Wraps a server action with useActionState and publishes its field errors to
 * any <FieldError> inside it, so server-rendered pages can compose plain inputs
 * without each form needing its own client component.
 */
export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess = false,
}: {
  action: ServerAction;
  children: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(action, {});

  return (
    <form
      action={formAction}
      className={className}
      key={resetOnSuccess && state.success ? state.success : undefined}
    >
      <FieldErrorContext.Provider value={state.fieldErrors ?? {}}>
        <div className="space-y-4">
          <FormError message={state.error} />
          <FormSuccess message={state.success} />
          {children}
        </div>
      </FieldErrorContext.Provider>
    </form>
  );
}

export function FieldError({ name }: { name: string }) {
  const errors = useContext(FieldErrorContext);
  const messages = errors[name];
  if (!messages?.length) return null;
  return <p className="mt-1 text-[12px] text-red-700">{messages.join(" ")}</p>;
}

export function SubmitButton({
  children,
  pendingLabel,
  ...props
}: ComponentProps<typeof Button> & { pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button {...props} type="submit" disabled={pending || props.disabled}>
      {pending ? (pendingLabel ?? "Working…") : children}
    </Button>
  );
}

/**
 * A one-button form for row actions (suspend, remove, reinstate). Errors
 * surface via alert rather than inline, keeping table rows compact.
 */
export function ActionButton({
  action,
  fields,
  confirm,
  children,
  variant = "secondary",
  className,
}: {
  action: ServerAction;
  fields: Record<string, string>;
  confirm?: string;
  children: ReactNode;
  variant?: ComponentProps<typeof Button>["variant"];
  className?: string;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(action, {});

  return (
    <form
      action={formAction}
      className={className}
      onSubmit={(event) => {
        if (confirm && !window.confirm(confirm)) event.preventDefault();
      }}
    >
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <SubmitButton variant={variant} className="!px-2 !py-1 !text-[12px]">
        {children}
      </SubmitButton>
      {state.error ? (
        <p className="mt-1 text-[12px] text-red-700">{state.error}</p>
      ) : null}
    </form>
  );
}
