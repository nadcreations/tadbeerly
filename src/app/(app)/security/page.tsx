import QRCode from "qrcode";
import { requireUser } from "@/lib/authz";
import {
  getMfaStatus,
  getPendingEnrolment,
  countUnusedRecoveryCodes,
} from "@/lib/mfa";
import {
  beginMfaEnrolment,
  confirmMfaEnrolment,
  disableMfa,
  regenerateRecoveryCodes,
} from "@/lib/actions/mfa";
import { formatSecretForDisplay } from "@/lib/totp";
import { ActionForm, FieldError, SubmitButton } from "@/components/forms";
import { MfaCodeForm } from "@/components/MfaCodeForm";
import { CopyButton } from "@/components/CopyButton";
import { Badge, Card, CardHeader, Input, PageHeader } from "@/components/ui";
import { formatDate } from "@/lib/format";

export const metadata = { title: "Security — Tadbeerly" };

export default async function SecurityPage() {
  const user = await requireUser();
  const status = await getMfaStatus(user.id);
  const enabled = status?.mfaEnabled ?? false;
  const orgRequires = status?.requireMfa ?? false;
  const adminRequires = user.role?.isLocked ?? false;
  const required = orgRequires || adminRequires;

  const [pending, remainingCodes] = await Promise.all([
    enabled ? Promise.resolve(null) : getPendingEnrolment(user.id, user.email),
    enabled ? countUnusedRecoveryCodes(user.id) : Promise.resolve(0),
  ]);

  // Rendered server-side as an inline SVG: the QR never travels to a third
  // party, and there is no client-side library to ship.
  const qrSvg = pending
    ? await QRCode.toString(pending.uri, {
        type: "svg",
        margin: 1,
        width: 200,
        errorCorrectionLevel: "M",
      })
    : null;

  return (
    <>
      <PageHeader
        title="Security"
        description="Two-step verification adds a code from your phone on top of your password."
      />

      <div className="max-w-3xl space-y-6">
        {required && !enabled ? (
          <Card className="border-amber-300 bg-amber-50 px-4 py-4">
            <p className="text-[13px] font-medium text-amber-900">
              {orgRequires
                ? `${user.organizationName} requires two-step verification.`
                : "Administrators must use two-step verification."}
            </p>
            <p className="mt-1 text-[13px] text-amber-800">
              Finish the setup below to carry on using Tadbeerly. Until you do, the
              rest of the application is closed to you.
            </p>
          </Card>
        ) : null}

        <Card>
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                Two-step verification
                {enabled ? (
                  <Badge tone="success">on</Badge>
                ) : (
                  <Badge tone="neutral">off</Badge>
                )}
                {required ? <Badge tone="info">required</Badge> : null}
              </span>
            }
            description={
              enabled
                ? `Switched on ${formatDate(status?.mfaEnrolledAt)}. You will be asked for a code each time you sign in.`
                : "You will be asked for a 6-digit code from an authenticator app each time you sign in."
            }
          />

          {enabled ? (
            <div className="space-y-5 px-4 py-5">
              <div className="rounded-md border border-ink-200 px-4 py-3">
                <p className="text-[13px] font-medium text-ink-900">
                  Recovery codes
                </p>
                <p className="mt-0.5 text-[13px] text-ink-600">
                  {remainingCodes} of 10 unused.
                  {remainingCodes <= 2
                    ? " Generate a new set soon — you are nearly out."
                    : ""}
                </p>
              </div>

              <div>
                <h3 className="text-[13px] font-semibold text-ink-900">
                  Generate new recovery codes
                </h3>
                <p className="mt-0.5 mb-3 text-[13px] text-ink-500">
                  Replaces all ten. Any code you have written down stops working.
                </p>
                <MfaCodeForm
                  action={regenerateRecoveryCodes}
                  label="Generate new codes"
                  pendingLabel="Generating…"
                  hint="Confirm with a current code from your app."
                />
              </div>

              {required ? (
                <div className="rounded-md border border-ink-200 bg-ink-50 px-4 py-3 text-[13px] text-ink-600">
                  Two-step verification cannot be switched off because{" "}
                  {orgRequires ? `${user.organizationName} requires it` : "your role requires it"}.
                </div>
              ) : (
                <div className="border-t border-ink-100 pt-5">
                  <h3 className="text-[13px] font-semibold text-ink-900">
                    Switch off two-step verification
                  </h3>
                  <p className="mt-0.5 mb-3 text-[13px] text-ink-500">
                    Your account will be protected by password alone.
                  </p>
                  <ActionForm action={disableMfa}>
                    <div>
                      <label
                        htmlFor="password"
                        className="block text-[13px] font-medium text-ink-800"
                      >
                        Confirm your password
                      </label>
                      <Input
                        id="password"
                        name="password"
                        type="password"
                        autoComplete="current-password"
                        required
                        className="mt-1.5 max-w-sm"
                      />
                      <FieldError name="password" />
                    </div>
                    <SubmitButton variant="danger" pendingLabel="Switching off…">
                      Switch off
                    </SubmitButton>
                  </ActionForm>
                </div>
              )}
            </div>
          ) : pending && qrSvg ? (
            <div className="space-y-5 px-4 py-5">
              <ol className="space-y-4">
                <li className="flex gap-3">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ink-900 text-[12px] font-semibold text-white">
                    1
                  </span>
                  <div>
                    <p className="text-[13px] text-ink-800">
                      Install an authenticator app if you do not have one —
                      Microsoft Authenticator, Google Authenticator and 1Password
                      all work.
                    </p>
                  </div>
                </li>
                <li className="flex gap-3">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ink-900 text-[12px] font-semibold text-white">
                    2
                  </span>
                  <div className="min-w-0">
                    <p className="text-[13px] text-ink-800">
                      Scan this code with the app.
                    </p>
                    <div
                      className="mt-3 inline-block rounded-md border border-ink-200 bg-white p-2"
                      dangerouslySetInnerHTML={{ __html: qrSvg }}
                    />
                    <p className="mt-3 text-[13px] text-ink-600">
                      Cannot scan? Enter this key by hand:
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <code className="rounded border border-ink-200 bg-ink-50 px-2.5 py-1.5 font-mono text-[13px] tracking-wider text-ink-900">
                        {formatSecretForDisplay(pending.secret)}
                      </code>
                      <CopyButton value={pending.secret} label="Copy key" />
                    </div>
                  </div>
                </li>
                <li className="flex gap-3">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ink-900 text-[12px] font-semibold text-white">
                    3
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="mb-3 text-[13px] text-ink-800">
                      Enter the code the app shows to finish.
                    </p>
                    <MfaCodeForm
                      action={confirmMfaEnrolment}
                      label="Turn on two-step verification"
                      pendingLabel="Verifying…"
                    />
                  </div>
                </li>
              </ol>
            </div>
          ) : (
            <div className="px-4 py-5">
              <ActionForm action={beginMfaEnrolment}>
                <SubmitButton pendingLabel="Preparing…">
                  Set up two-step verification
                </SubmitButton>
              </ActionForm>
            </div>
          )}
        </Card>

        <Card>
          <CardHeader
            title="How your account is protected"
            description="What Tadbeerly does, and what it does not do yet."
          />
          <ul className="space-y-2 px-4 py-4 text-[13px] text-ink-700">
            <li>
              Passwords are hashed with scrypt — they are never stored in a form
              that can be read back.
            </li>
            <li>
              Sessions last 12 hours and are stored hashed, so a database leak
              does not yield working sessions.
            </li>
            <li>
              Your TOTP secret is encrypted before it is stored, with a key held
              in the server environment rather than the database.
            </li>
            <li className="text-ink-500">
              Not yet available: passkeys, SMS codes and trusted devices.
            </li>
          </ul>
        </Card>
      </div>
    </>
  );
}
