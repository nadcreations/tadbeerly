import { loadPasswordReset } from "@/lib/passwordReset";
import { completePasswordReset } from "@/lib/actions/passwordReset";
import { ActionForm, FieldError, SubmitButton } from "@/components/forms";
import { Card, Input, LinkButton } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function PasswordResetPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const loaded = await loadPasswordReset(token);

  if (!loaded) {
    return (
      <Card className="p-6 text-center">
        <h1 className="text-lg font-semibold tracking-tight text-ink-900">
          Link not usable
        </h1>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-500">
          This reset link is invalid or has expired.
        </p>
        <LinkButton href="/forgot" variant="secondary" className="mt-5">
          Request a new link
        </LinkButton>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <h1 className="text-lg font-semibold tracking-tight text-ink-900">
        Set a new password
      </h1>
      <p className="mt-1 text-[13px] leading-relaxed text-ink-500">
        For {loaded.email}.
      </p>

      <ActionForm action={completePasswordReset} className="mt-5">
        <input type="hidden" name="token" value={token} />

        <div>
          <label htmlFor="password" className="block text-[13px] font-medium text-ink-800">
            New password <span className="text-red-700">*</span>
          </label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            className="mt-1.5"
          />
          <p className="mt-1 text-[12px] text-ink-500">At least 10 characters.</p>
          <FieldError name="password" />
        </div>

        <div>
          <label htmlFor="confirm" className="block text-[13px] font-medium text-ink-800">
            Confirm password <span className="text-red-700">*</span>
          </label>
          <Input
            id="confirm"
            name="confirm"
            type="password"
            autoComplete="new-password"
            required
            className="mt-1.5"
          />
          <FieldError name="confirm" />
        </div>

        <SubmitButton className="w-full" pendingLabel="Saving…">
          Set password and sign out everywhere
        </SubmitButton>
      </ActionForm>

      <p className="mt-5 border-t border-ink-100 pt-4 text-[12px] leading-relaxed text-ink-500">
        This link works once. Setting a password signs this account out of every
        device. If two-step verification is switched on, you will still be asked
        for a code when you sign in.
      </p>
    </Card>
  );
}
