/**
 * Creates an organization and its first administrator. An operator command,
 * deliberately not reachable over HTTP.
 *
 *   npm run org:create -- --name "Acme" --email jane@acme.example \
 *     --first Jane --last Smith [--password "a-strong-password"]
 *
 * Without --password the administrator is invited and the invitation URL is printed.
 */
import { createOrganizationWithAdmin } from "../src/lib/organizations";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(`--${flag}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main() {
  const name = arg("name");
  const email = arg("email");
  const firstName = arg("first");
  const lastName = arg("last");
  const password = arg("password");

  if (!name || !email || !firstName || !lastName) {
    console.error(
      [
        "",
        "Missing required options.",
        "",
        '  npm run org:create -- --name "Acme" --email jane@acme.example \\',
        "      --first Jane --last Smith [--password 'a-strong-password']",
        "",
      ].join("\n"),
    );
    process.exit(1);
  }

  const result = await createOrganizationWithAdmin({
    name,
    admin: { email, firstName, lastName, password },
  });

  console.log(`Organization ID: ${result.organizationId}`);
  console.log(`Admin user ID:   ${result.adminUserId}`);
  if (result.invitationUrl) console.log(`Invitation URL:  ${result.invitationUrl}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
