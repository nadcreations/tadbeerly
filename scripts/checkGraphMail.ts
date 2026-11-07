import { loadEnv } from "@/lib/env";
import { graphCredentials, graphToken } from "@/lib/graphToken";

loadEnv();

/**
 * Whether Microsoft will let this application send mail — answered without
 * sending any.
 *
 * `Mail.Send` is granted by an administrator in a different console from the
 * one the application is configured in, so the usual way to discover it is
 * missing is a 403 in the outbox some hours later. The grant is recorded in the
 * token itself: Entra puts the application permissions in a `roles` claim, and
 * the token can be read without calling a single Graph endpoint.
 *
 *   npm run email:graph-check
 */
async function main() {
  const credentials = graphCredentials();
  if (!credentials) {
    console.error(
      "No Graph credentials. Set GRAPH_TENANT_ID, GRAPH_CLIENT_ID and " +
        "GRAPH_CLIENT_SECRET, or the SHAREPOINT_ equivalents.",
    );
    process.exit(1);
  }

  const sender = process.env.GRAPH_MAIL_SENDER ?? process.env.EMAIL_FROM;
  console.log(`tenant   ${credentials.tenantId}`);
  console.log(`client   ${credentials.clientId}`);
  console.log(`sender   ${sender ?? "(EMAIL_FROM is not set)"}`);

  const token = await graphToken(credentials);

  // The middle segment of a JWT is base64url JSON. Read, not verified — this is
  // reporting what the issuer said, not trusting it with anything.
  const claims = JSON.parse(
    Buffer.from(token.split(".")[1], "base64").toString("utf8"),
  ) as { roles?: string[]; app_displayname?: string };

  const roles = claims.roles ?? [];
  console.log(`app      ${claims.app_displayname ?? "(unnamed)"}`);
  console.log(`roles    ${roles.join(", ") || "(none)"}`);
  console.log("");

  if (!roles.includes("Mail.Send")) {
    console.log(
      "Mail.Send is NOT granted. Until it is, EMAIL_TRANSPORT=graph will fail\n" +
        "with 403 on every message. An administrator needs to add it:\n" +
        "  Entra ID > App registrations > this app > API permissions\n" +
        "  > Add a permission > Microsoft Graph > Application permissions\n" +
        "  > Mail.Send > Add, then Grant admin consent.",
    );
    process.exit(1);
  }

  console.log("Mail.Send is granted.");
  if (!sender) {
    console.log("But EMAIL_FROM is unset, so there is no mailbox to send from.");
    process.exit(1);
  }
  console.log(
    "Graph will accept mail from this app. Send a real one with:\n" +
      "  npm run email:test -- you@example.com",
  );
  process.exit(0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
