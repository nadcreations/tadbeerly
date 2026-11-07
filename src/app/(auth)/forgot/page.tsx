import { requestReset } from "@/lib/actions/passwordReset";
import { ActionForm, FieldError, SubmitButton } from "@/components/forms";
import { Card, Input, LinkButton } from "@/components/ui";

export default function ForgotPasswordPage() {
  return (
    <Card className="p-6">
      <h1 className="text-xl font-semibold tracking-tight text-ink-900">
        Reset your password
      </h1>
      <p className="mt-1 text-[13px] text-ink-500">
        Enter your email address and we will send you a link to choose a new
        password.
      </p>

      <ActionForm action={requestReset} className="mt-6">
        <div>
          <label htmlFor="email" className="block text-[13px] font-medium text-ink-800">
            Email address
          </label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            required
            className="mt-1.5"
          />
          <FieldError name="email" />
        </div>

        <SubmitButton className="w-full" pendingLabel="Sending…">
          Send reset link
        </SubmitButton>
      </ActionForm>

      <LinkButton href="/login" variant="secondary" className="mt-5 w-full">
        Back to sign in
      </LinkButton>
    </Card>
  );
}
