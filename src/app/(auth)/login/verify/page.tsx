import { redirect } from "next/navigation";
import { homeFor } from "@/lib/authz";
import { getChallenge } from "@/lib/mfa";
import { getCurrentUser } from "@/lib/session";
import {
  verifyMfaChallenge,
  cancelMfaChallenge,
} from "@/lib/actions/mfa";
import { ActionForm, FieldError, SubmitButton } from "@/components/forms";
import { Button, Card, Input } from "@/components/ui";

export const metadata = { title: "Verification — Tadbeerly" };

export default async function VerifyPage() {
  const user = await getCurrentUser();
  if (user) redirect(homeFor(user));

  // No challenge means the password step was never completed — send them back
  // rather than showing a code box that could never succeed.
  const challenge = await getChallenge();
  if (!challenge) redirect("/login");

  return (
    <Card className="p-6">
      <h1 className="text-lg font-semibold tracking-tight text-ink-900">
        Two-step verification
      </h1>
      <p className="mt-1 text-[13px] text-ink-500">
        Enter the 6-digit code from your authenticator app for{" "}
        <span className="font-medium text-ink-700">{challenge.email}</span>.
      </p>

      <ActionForm action={verifyMfaChallenge} className="mt-6">
        <div>
          <label htmlFor="code" className="block text-[13px] font-medium text-ink-800">
            Verification code
          </label>
          <Input
            id="code"
            name="code"
            inputMode="text"
            autoComplete="one-time-code"
            autoFocus
            required
            placeholder="123456"
            className="mt-1.5 text-center font-mono text-lg tracking-[0.3em]"
          />
          <FieldError name="code" />
          <p className="mt-1.5 text-[12px] text-ink-500">
            Lost your phone? Enter one of your recovery codes instead — they
            look like <code>ABCDE-FGHIJ</code>.
          </p>
        </div>

        <SubmitButton className="w-full" pendingLabel="Verifying…">
          Verify and sign in
        </SubmitButton>
      </ActionForm>

      <form action={cancelMfaChallenge} className="mt-3">
        <Button type="submit" variant="ghost" className="w-full">
          Cancel and sign in as someone else
        </Button>
      </form>

      <p className="mt-6 border-t border-ink-100 pt-4 text-[12px] text-ink-500">
        This step expires after five minutes, and after five wrong codes you
        will need to sign in again.
      </p>
    </Card>
  );
}
