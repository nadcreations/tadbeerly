/**
 * Seeds two demonstration organizations so the tenancy rules can be exercised
 * straight away.
 *
 * Run with: npm run db:seed
 *
 * Destructive: it empties every table first, so it refuses to run against
 * anything but a database on this machine. There is no override.
 *
 * The data is made through the real services, so the audit trail, role
 * clones and invitations are exactly what production code produces. The
 * outbox is emptied at the end: seed data must never send mail.
 */
import { pathToFileURL } from "node:url";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { emailNotifications, organizations, roles, users } from "@/db/schema";
import { truncateAllTables } from "@/db/truncate";
import { changeAgentRole, inviteAgent, setAgentStatus } from "@/lib/agents";
import { recordAudit } from "@/lib/audit";
import type { Actor } from "@/lib/authz";
import { setTransportForTests } from "@/lib/email/transport";
import { loadEnv } from "@/lib/env";
import { acceptInvitation } from "@/lib/invitations";
import { createOrganizationWithAdmin } from "@/lib/organizations";
import { updateOrganization } from "@/lib/organizationSettings";
import { ALL_PERMISSIONS } from "@/lib/permissions";
import { createRole, updateRolePermissions } from "@/lib/rolesAdmin";

export const DEMO_PASSWORD = "Password123!";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

/** Throws unless the database this process would write to is on this machine. */
function assertLocalDatabase(): void {
  const url = process.env.DATABASE_URL ?? process.env.NETLIFY_DATABASE_URL;
  let host: string | null = null;
  try {
    host = url ? new URL(url).hostname : null;
  } catch {
    host = null;
  }
  if (!host || !LOCAL_HOSTS.has(host)) {
    throw new Error(
      `Refusing to seed: the seed empties every table, so it only runs against a database on localhost or 127.0.0.1 (DATABASE_URL host is ${host ?? "missing or unreadable"}).`,
    );
  }
}

export type SeedSummary = {
  accounts: { organization: string; email: string; name: string; role: string }[];
  ginaInvitationUrl: string;
};

const tokenOf = (url: string) => url.split("/").pop()!;

/**
 * Services dispatch their queued mail straight after committing. A no-op
 * transport means a configured SMTP or Graph account is never touched, and
 * the outbox is cleared at the end regardless.
 */
function silenceMail(): void {
  setTransportForTests({ name: "seed", send: async () => {} });
}

export async function runSeed(): Promise<SeedSummary> {
  loadEnv();
  assertLocalDatabase();
  silenceMail();

  await truncateAllTables();

  /* ------------------------------ Meridian Group ------------------------------ */
  const meridian = await createOrganizationWithAdmin({
    name: "Meridian",
    admin: {
      email: "alice@meridian.example",
      firstName: "Alice",
      lastName: "Hartley",
      password: DEMO_PASSWORD,
    },
  });
  const orgId = meridian.organizationId;
  const alice: Actor = {
    id: meridian.adminUserId,
    organizationId: orgId,
    permissions: [...ALL_PERMISSIONS],
  };

  const roleIdOf = async (key: string) => {
    const [role] = await db
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.organizationId, orgId), eq(roles.key, key)));
    return role.id;
  };
  const supervisorId = await roleIdOf("supervisor");
  const agentId = await roleIdOf("agent");
  const readOnlyId = await roleIdOf("read_only");

  await updateOrganization(alice, { name: "Meridian Group" });

  const people = [
    { email: "carol@meridian.example", firstName: "Carol", lastName: "Mbeki", jobTitle: "Support Supervisor", roleId: supervisorId },
    { email: "dan@meridian.example", firstName: "Dan", lastName: "Okafor", jobTitle: "Support Agent", roleId: agentId },
    { email: "erin@meridian.example", firstName: "Erin", lastName: "Castellanos", jobTitle: "Support Agent", roleId: agentId },
    { email: "frank@meridian.example", firstName: "Frank", lastName: "Dubois", jobTitle: "Auditor", roleId: readOnlyId },
  ];
  const ids = new Map<string, string>();
  for (const person of people) {
    const invited = await inviteAgent(alice, person);
    ids.set(person.email, invited.userId);
    await acceptInvitation(tokenOf(invited.invitationUrl), DEMO_PASSWORD);
  }

  const gina = await inviteAgent(alice, {
    email: "gina@meridian.example",
    firstName: "Gina",
    lastName: "Rossi",
    jobTitle: "Support Agent",
    roleId: agentId,
  });

  // A custom role, as an administrator would make one for a new kind of work.
  const { roleId: leadId } = await createRole(alice, {
    name: "Team Lead",
    description: "Reads the audit trail for the team.",
    copyFromRoleId: agentId,
  });
  await updateRolePermissions(alice, leadId, ["admin.audit"]);

  // Erin is away for a spell: her account is switched off, then back on.
  const erinId = ids.get("erin@meridian.example")!;
  const danId = ids.get("dan@meridian.example")!;
  await setAgentStatus(alice, erinId, "disabled");
  await setAgentStatus(alice, erinId, "active");
  await changeAgentRole(alice, danId, supervisorId);
  await changeAgentRole(alice, danId, agentId);

  // The sign-in action is not run here, so its events are written directly.
  const signIns: [string, string][] = [
    [alice.id, "Alice Hartley"],
    [ids.get("carol@meridian.example")!, "Carol Mbeki"],
    [danId, "Dan Okafor"],
    [erinId, "Erin Castellanos"],
  ];
  for (const [userId, name] of signIns) {
    await recordAudit({
      action: "auth.login",
      summary: `${name} signed in`,
      organizationId: orgId,
      actorUserId: userId,
      entityType: "user",
      entityId: userId,
    });
  }
  await recordAudit({
    action: "auth.login_failed",
    summary: "Failed sign-in for frank@meridian.example",
    organizationId: orgId,
    entityType: "user",
    entityId: ids.get("frank@meridian.example")!,
  });
  await recordAudit({
    action: "auth.logout",
    summary: "Dan Okafor signed out",
    organizationId: orgId,
    actorUserId: danId,
    entityType: "user",
    entityId: danId,
  });

  /* ----------------------------- Kestrel Services ----------------------------- */
  const kestrel = await createOrganizationWithAdmin({
    name: "Kestrel Services",
    admin: {
      email: "bob@kestrel.example",
      firstName: "Bob",
      lastName: "Lindqvist",
      password: DEMO_PASSWORD,
    },
  });
  await recordAudit({
    action: "auth.login",
    summary: "Bob Lindqvist signed in",
    organizationId: kestrel.organizationId,
    actorUserId: kestrel.adminUserId,
    entityType: "user",
    entityId: kestrel.adminUserId,
  });

  // Seed data must not trigger mail: whatever the services queued is dropped.
  await db.delete(emailNotifications);

  const rows = await db
    .select({
      organization: organizations.name,
      email: users.email,
      firstName: users.firstName,
      lastName: users.lastName,
      role: roles.name,
      status: users.status,
    })
    .from(users)
    .innerJoin(organizations, eq(organizations.id, users.organizationId))
    .innerJoin(roles, eq(roles.id, users.roleId))
    .orderBy(organizations.name, users.email);

  return {
    accounts: rows.map((r) => ({
      organization: r.organization,
      email: r.email,
      name: `${r.firstName} ${r.lastName}`,
      role: r.status === "invited" ? `${r.role} (invited)` : r.role,
    })),
    ginaInvitationUrl: gina.invitationUrl,
  };
}

export async function seed(): Promise<void> {
  await runSeed();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runSeed()
    .then((summary) => {
      const width = (key: "organization" | "email" | "name") =>
        Math.max(...summary.accounts.map((a) => a[key].length));
      console.log("\nSeeded. Accounts:\n");
      for (const a of summary.accounts) {
        console.log(
          `  ${a.organization.padEnd(width("organization"))}  ${a.email.padEnd(width("email"))}  ${a.name.padEnd(width("name"))}  ${a.role}`,
        );
      }
      console.log(`\nPassword for every active account: ${DEMO_PASSWORD}`);
      console.log(`Gina's invitation (pending): ${summary.ginaInvitationUrl}`);
      console.log(
        "\nAdministrators must enrol in two-factor authentication at first sign-in: the app sends them to Security until they do.\n",
      );
      process.exit(0);
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
