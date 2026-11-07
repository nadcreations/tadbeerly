import { loadInvitation } from "@/lib/invitations";
import { acceptInvitationAction } from "@/lib/actions/invitations";
import { ActionForm, FieldError, SubmitButton } from "@/components/forms";
import { Card, Input, LinkButton } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function InvitationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const invitation = await loadInvitation(token);

  if (!invitation) {
    return (
      <Card className="p-6 text-center">
        <h1 className="text-lg font-semibold tracking-tight text-ink-900">
          Invitation not usable
        </h1>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-500">
          This invitation is invalid or has expired. Ask your administrator to send a new
          one.
        </p>
        <LinkButton href="/login" variant="secondary" className="mt-5">
          Go to sign in
        </LinkButton>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <h1 className="text-lg font-semibold tracking-tight text-ink-900">
        Join {invitation.organizationName}
      </h1>
      <p className="mt-1 text-[13px] leading-relaxed text-ink-500">
        Welcome, {invitation.firstName}. Choose a password to activate your account for{" "}
        <span className="font-medium text-ink-800">{invitation.email}</span>.
      </p>

      <ActionForm action={acceptInvitationAction} className="mt-5">
        <input type="hidden" name="token" value={token} />

        <div>
          <label htmlFor="password" className="block text-[13px] font-medium text-ink-800">
            Password <span className="text-red-700">*</span>
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

        <SubmitButton className="w-full" pendingLabel="Activating…">
          Activate account and sign in
        </SubmitButton>
      </ActionForm>
    </Card>
  );
}
