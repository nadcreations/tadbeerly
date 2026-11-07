import { loadEnv } from "@/lib/env";
import { getTransport } from "@/lib/email/transport";
import { appUrl, userInvitationEmail } from "@/lib/email/templates";

/*
 * Before the transport is chosen. This script touches no database, so nothing
 * else was ever going to load `.env.local` — which meant EMAIL_TRANSPORT read
 * as unset, the console transport was selected, and the test printed the
 * message and reported success without a mail server being involved at all.
 * The one result this script must never produce is a pass that proves nothing.
 */
loadEnv();

/**
 * Sends one real message through whatever transport is configured.
 *
 * Deliberately renders a genuine template rather than a "hello world": what
 * needs checking is not that a socket opens (`email:verify` proves that) but
 * that a message the application actually produces arrives intact, with its
 * heading and action button surviving the recipient's mail client.
 *
 *   npm run email:test -- someone@example.com
 */
async function main() {
  const to = process.argv[2];
  if (!to || !to.includes("@")) {
    console.error("Usage: npm run email:test -- someone@example.com");
    process.exit(1);
  }

  const transport = getTransport();
  const content = userInvitationEmail({
    inviterName: "Tadbeerly Test",
    organizationName: "Test Organization",
    firstName: "there",
    url: appUrl("/invitations/test"),
  });

  console.log(`transport: ${process.env.EMAIL_TRANSPORT ?? "console"}`);
  console.log(`from:      ${process.env.EMAIL_FROM}`);
  console.log(`to:        ${to}`);
  console.log(`subject:   ${content.subject}`);

  await transport.send({
    to,
    subject: content.subject,
    text: content.text,
    html: content.html,
  });

  console.log("\nRESULT: accepted by the server for delivery.");
  process.exit(0);
}

main().catch((error) => {
  console.error("\nRESULT: FAILED");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
