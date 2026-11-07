import { loadEnv } from "@/lib/env";

loadEnv();

export function appUrl(path = ""): string {
  const base = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return `${base}${path}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export type EmailContent = { subject: string; text: string; html: string };

export type Composition = {
  subject: string;
  heading: string;
  /** Opening line, plain sentence. */
  intro: string;
  /** Label/value pairs rendered as a definition list. */
  facts?: [string, string][];
  /** Free text, e.g. a message body. Rendered pre-wrapped. */
  quote?: string | null;
  /** The button. `url` is absolute; build it with `appUrl` when needed. */
  action?: { label: string; url: string };
  /** Why the recipient is getting this, shown in the footer. */
  reason?: string;
};

const DEFAULT_REASON = "You are receiving this because you have an account on Tadbeerly.";

/**
 * One layout for every notification. Plain text is generated from the same
 * structure rather than written twice, so the two can never drift.
 */
export function compose(input: Composition): EmailContent {
  const url = input.action?.url ?? null;
  const reason = input.reason ?? DEFAULT_REASON;

  const textLines = [input.heading, "", input.intro];

  if (input.facts?.length) {
    textLines.push("");
    for (const [label, value] of input.facts) {
      textLines.push(`${label}: ${value}`);
    }
  }

  if (input.quote) {
    textLines.push("", "---", input.quote, "---");
  }

  if (input.action && url) {
    textLines.push("", `${input.action.label}: ${url}`);
  }

  textLines.push("", reason, "Manage your account: " + appUrl("/security"));

  /*
   * The colours are written as literals: mail clients strip stylesheets and
   * none of them resolve custom properties, so these are kept in step with
   * `globals.css` by hand.
   *
   * The layout is tables on purpose. Desktop Outlook renders mail with Word's
   * engine, which ignores `max-width` with `margin:0 auto`, padding on an
   * inline-block anchor, and vertical-align between an image and text. It does
   * honour a cell's padding and alignment and a table's width attribute, so the
   * card is centred by `align="center"` on a cell, and its width is held two
   * ways: a percentage with a max-width for every other client, and a hard 560
   * inside an `mso` conditional that only Word reads. Rounded corners are lost
   * in Outlook, which is not worth an image to fake.
   */
  const html = `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#fbf7f0;margin:0;padding:0;width:100%;">
  <tr>
    <td align="center" style="padding:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
      <!--[if mso]><table role="presentation" width="560" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
      <table role="presentation" align="center" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;background:#ffffff;border:1px solid #e8e1d5;border-radius:8px;">
        <tr>
          <td style="padding:16px 24px;border-bottom:1px solid #f4f0e9;font-size:15px;font-weight:600;color:#191410;">
            Tadbeerly
          </td>
        </tr>
        <tr>
          <td style="padding:24px;">
      <h1 style="margin:0 0 8px;font-size:17px;color:#191410;">${escapeHtml(input.heading)}</h1>
      <p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:#473f35;">${escapeHtml(input.intro)}</p>
      ${
        input.facts?.length
          ? `<table style="width:100%;border-collapse:collapse;margin:0 0 16px;font-size:14px;">${input.facts
              .map(
                ([label, value]) =>
                  `<tr><td style="padding:4px 0;color:#786c5d;width:38%;vertical-align:top;">${escapeHtml(label)}</td><td style="padding:4px 0;color:#191410;">${escapeHtml(value)}</td></tr>`,
              )
              .join("")}</table>`
          : ""
      }
      ${
        input.quote
          ? `<div style="margin:0 0 16px;padding:12px 14px;background:#fdf9f2;border-left:3px solid #e7c48d;font-size:14px;line-height:1.5;color:#473f35;white-space:pre-wrap;">${escapeHtml(input.quote)}</div>`
          : ""
      }
      ${
        /*
         * The button, as a one-cell table: the padding lives on the cell and
         * the anchor fills it, because Word's engine drops padding from an
         * inline-block anchor. brand-700 rather than 600, so it starts from
         * 6.4:1 against white and survives a client's dark-mode inversion.
         */
        input.action && url
          ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 0;">
        <tr>
          <td style="background:#7f5623;border-radius:6px;padding:11px 20px;text-align:center;mso-padding-alt:11px 20px;">
            <a href="${escapeHtml(url)}" style="display:inline-block;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;line-height:18px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">${escapeHtml(input.action.label)}</a>
          </td>
        </tr>
      </table>`
          : ""
      }
          </td>
        </tr>
        <tr>
          <td style="padding:14px 24px;border-top:1px solid #f4f0e9;font-size:12px;color:#998d7c;line-height:1.5;">
            ${escapeHtml(reason)}
            <br /><a href="${escapeHtml(appUrl("/security"))}" style="color:#7f5623;">Manage your account</a>
          </td>
        </tr>
      </table>
      <!--[if mso]></td></tr></table><![endif]-->
    </td>
  </tr>
</table>`.trim();

  return { subject: input.subject, text: textLines.join("\n"), html };
}

/* ------------------------------- Templates ------------------------------- */

export function userInvitationEmail(input: {
  inviterName: string;
  organizationName: string;
  firstName: string;
  url: string;
}): EmailContent {
  return compose({
    subject: `You're invited to ${input.organizationName} on Tadbeerly`,
    heading: `Welcome, ${input.firstName}`,
    intro: `${input.inviterName} has invited you to join ${input.organizationName} on Tadbeerly. Accept the invitation and choose a password to activate your account.`,
    action: { label: "Accept invitation", url: input.url },
    reason: "You are receiving this because an administrator invited you to Tadbeerly.",
  });
}

/** Told to whoever sent the invitation, once it is taken up. */
export function invitationAcceptedEmail(input: {
  name: string;
  organizationName: string;
}): EmailContent {
  return compose({
    subject: `${input.name} joined ${input.organizationName}`,
    heading: `${input.name} accepted your invitation`,
    intro: `${input.name} has set up their account and joined ${input.organizationName} on Tadbeerly.`,
    action: { label: "Open Tadbeerly", url: appUrl("/admin/agents") },
    reason: "You are receiving this because you invited this person to Tadbeerly.",
  });
}

export function passwordResetEmail(input: {
  firstName: string;
  url: string;
  expiresInLabel: string;
}): EmailContent {
  return compose({
    subject: "Reset your Tadbeerly password",
    heading: `Reset your password, ${input.firstName}`,
    intro: `Use the button below to choose a new password. The link expires in ${input.expiresInLabel}. If you did not ask for this, you can ignore this email.`,
    action: { label: "Choose a new password", url: input.url },
    reason: "You are receiving this because a password reset was requested for your account.",
  });
}
