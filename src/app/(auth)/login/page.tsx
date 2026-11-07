import { redirect } from "next/navigation";
import { login } from "@/lib/actions/auth";
import { homeFor } from "@/lib/authz";
import { getCurrentUser } from "@/lib/session";
import { ActionForm, FieldError, SubmitButton } from "@/components/forms";
import { Card, Input } from "@/components/ui";

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect(homeFor(user));

  return (
    <Card className="p-6">
      <h1 className="text-xl font-semibold tracking-tight text-ink-900">Sign in</h1>
      <p className="mt-1 text-[13px] text-ink-500">
        Use the account issued by your organization.
      </p>

      <ActionForm action={login} className="mt-6">
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

        <div>
          <label htmlFor="password" className="block text-[13px] font-medium text-ink-800">
            Password
          </label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className="mt-1.5"
          />
          <FieldError name="password" />
        </div>

        <SubmitButton className="w-full" pendingLabel="Signing in…">
          Sign in
        </SubmitButton>
      </ActionForm>

      <p className="mt-6 border-t border-ink-100 pt-4 text-[13px] leading-relaxed text-ink-500">
        Access is by invitation. If you need an account, ask an administrator
        at your organization to add you.
      </p>
    </Card>
  );
}
