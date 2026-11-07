import nodemailer, { type Transporter } from "nodemailer";
import { loadEnv } from "@/lib/env";
import { graphCredentials, graphToken } from "@/lib/graphToken";

loadEnv();

export type OutgoingEmail = {
  to: string;
  toName?: string | null;
  subject: string;
  text: string;
  html: string;
};

/**
 * One narrow interface, four backends. Which one runs is an environment
 * decision, not a code decision, so a deployment can move from console to SMTP
 * to a hosted API without touching anything that produces notifications.
 */
export interface EmailTransport {
  readonly name: string;
  send(email: OutgoingEmail): Promise<void>;
}

/** Just the address, with no display name wrapped round it. */
function senderAddress(): string {
  return process.env.EMAIL_FROM ?? "tadbeerly@localhost";
}

function fromAddress(): string {
  const name = process.env.EMAIL_FROM_NAME ?? "Tadbeerly";
  return `${name} <${senderAddress()}>`;
}

/** Development default: prints instead of sending, so nothing escapes by accident. */
class ConsoleTransport implements EmailTransport {
  readonly name = "console";

  async send(email: OutgoingEmail): Promise<void> {
    console.info(
      [
        "",
        "──────────────── email (console transport) ────────────────",
        `From:    ${fromAddress()}`,
        `To:      ${email.toName ? `${email.toName} <${email.to}>` : email.to}`,
        `Subject: ${email.subject}`,
        "",
        email.text,
        "───────────────────────────────────────────────────────────",
        "",
      ].join("\n"),
    );
  }
}

class SmtpTransport implements EmailTransport {
  readonly name = "smtp";
  private transporter: Transporter | null = null;

  private get client(): Transporter {
    if (!this.transporter) {
      const host = process.env.SMTP_HOST;
      if (!host) {
        throw new Error("EMAIL_TRANSPORT=smtp requires SMTP_HOST.");
      }
      const port = Number(process.env.SMTP_PORT ?? 587);
      this.transporter = nodemailer.createTransport({
        host,
        port,
        // Implicit TLS on 465; STARTTLS is negotiated on everything else.
        secure: process.env.SMTP_SECURE === "true" || port === 465,
        auth: process.env.SMTP_USER
          ? {
              user: process.env.SMTP_USER,
              pass: process.env.SMTP_PASSWORD ?? "",
            }
          : undefined,
        /*
         * Bounded, because this runs inside a request.
         *
         * Nodemailer waits indefinitely by default. A mail server that accepts
         * the connection and then stops talking will hold the socket until the
         * platform kills the whole function — the caller sees a gateway
         * timeout and learns nothing, and the outbox never records why. Eight
         * seconds is generous for a handshake and still leaves room for the
         * dispatcher to record the failure and move on.
         */
        connectionTimeout: 8000,
        greetingTimeout: 8000,
        socketTimeout: 8000,
      });
    }
    return this.transporter;
  }

  async send(email: OutgoingEmail): Promise<void> {
    await this.client.sendMail({
      from: fromAddress(),
      to: email.toName ? `"${email.toName.replace(/"/g, "")}" <${email.to}>` : email.to,
      subject: email.subject,
      text: email.text,
      html: email.html,
    });
  }
}

/** Hosted HTTP API — no SMTP server to run, no extra dependency. */
class ResendTransport implements EmailTransport {
  readonly name = "resend";

  async send(email: OutgoingEmail): Promise<void> {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error("EMAIL_TRANSPORT=resend requires RESEND_API_KEY.");

    let response: Response;
    try {
      response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: fromAddress(),
          // Addressed by name where there is one, so a notification does not
          // arrive from a system to an anonymous mailbox.
          to: [
            email.toName
              ? `${email.toName.replace(/["<>]/g, "")} <${email.to}>`
              : email.to,
          ],
          subject: email.subject,
          text: email.text,
          html: email.html,
        }),
        /*
         * Bounded, like the SMTP transport. fetch waits indefinitely by
         * default, and this runs inside a request — an API that accepts the
         * connection and stops responding would otherwise hold the socket
         * until the platform kills the whole function.
         */
        signal: AbortSignal.timeout(8000),
      });
    } catch (error) {
      // A timeout or a network failure, told plainly enough to act on.
      throw new Error(
        `Resend could not be reached: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `Resend rejected the message (${response.status}): ${detail.slice(0, 300)}`,
      );
    }
  }
}

/**
 * Microsoft 365, through the application's own Entra app registration.
 *
 * The reason this exists: Microsoft now refuses basic-auth SMTP tenant-wide
 * (`535 5.7.139 SmtpClientAuthentication is disabled for the Tenant`), and SMTP
 * from a serverless function has to finish its handshake inside the function's
 * lifetime, which it does not reliably do. Graph is one HTTPS call and neither
 * problem applies — and the mail still leaves from the organization's own
 * mailbox rather than a third party's infrastructure.
 *
 * It authenticates as the same application that stores documents in SharePoint,
 * sharing its cached token. What it needs beyond that is the `Mail.Send`
 * application permission, granted by an administrator.
 *
 * `Mail.Send` as an application permission is tenant-wide: it lets this app
 * send as any mailbox. Microsoft's remedy is an Application Access Policy
 * restricting it to one mailbox, and any tenant that cares should apply one.
 */
class GraphTransport implements EmailTransport {
  readonly name = "graph";

  async send(email: OutgoingEmail): Promise<void> {
    const credentials = graphCredentials();
    if (!credentials) {
      throw new Error(
        "EMAIL_TRANSPORT=graph requires GRAPH_TENANT_ID, GRAPH_CLIENT_ID and " +
          "GRAPH_CLIENT_SECRET (or the SHAREPOINT_ equivalents).",
      );
    }

    /*
     * The mailbox the message is sent from, which Graph addresses by name in
     * the URL. It has to be a real mailbox in the tenant: unlike SMTP, there is
     * no envelope sender to differ from the From header, so EMAIL_FROM has to
     * name something that exists.
     */
    const sender = process.env.GRAPH_MAIL_SENDER ?? senderAddress();

    const token = await graphToken(credentials);

    let response: Response;
    try {
      response = await fetch(
        `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message: {
              subject: email.subject,
              /*
               * HTML only. Graph's JSON message carries a single body with one
               * content type, so the plain-text alternative the templates also
               * produce is not sent. Keeping both would mean assembling MIME by
               * hand and base64-ing it, which trades a well-understood API for
               * an encoding bug waiting to happen; every template here renders
               * legibly as HTML, and the text part is still stored in the
               * outbox as the record of what was said.
               */
              body: { contentType: "HTML", content: email.html },
              toRecipients: [
                {
                  emailAddress: email.toName
                    ? { address: email.to, name: email.toName }
                    : { address: email.to },
                },
              ],
            },
            /*
             * The outbox is already the record of what was sent to whom, and it
             * is queryable. Copying every notification into a mailbox folder
             * would bury a human correspondent's Sent Items under machine mail.
             */
            saveToSentItems: false,
          }),
          // Bounded, like the others: this runs inside a request.
          signal: AbortSignal.timeout(8000),
        },
      );
    } catch (error) {
      throw new Error(
        `Microsoft Graph could not be reached: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // 202 Accepted with an empty body is the success case.
    if (response.ok) return;

    const detail = await response.text().catch(() => "");

    /*
     * The one failure worth naming, because it is the step most likely to have
     * been missed and its message does not say so.
     */
    if (response.status === 403) {
      throw new Error(
        `Microsoft Graph refused to send as ${sender} (403). The app ` +
          "registration most likely lacks the Mail.Send application " +
          "permission, or an Application Access Policy excludes this " +
          `mailbox: ${detail.slice(0, 200)}`,
      );
    }

    throw new Error(
      `Microsoft Graph rejected the message (${response.status}): ${detail.slice(0, 300)}`,
    );
  }
}

let cached: EmailTransport | null = null;
let override: EmailTransport | null = null;

/** Replaces the configured transport; pass null to restore it. Used by tests and the demo seed. */
export function setTransportOverride(t: EmailTransport | null): void {
  override = t;
}

/** Tests swap in a fake transport; pass null to restore the configured one. */
export const setTransportForTests = setTransportOverride;

export function getTransport(): EmailTransport {
  if (override) return override;
  if (cached) return cached;

  switch ((process.env.EMAIL_TRANSPORT ?? "console").toLowerCase()) {
    case "smtp":
      cached = new SmtpTransport();
      break;
    case "resend":
      cached = new ResendTransport();
      break;
    case "graph":
      cached = new GraphTransport();
      break;
    default:
      cached = new ConsoleTransport();
  }
  return cached;
}
