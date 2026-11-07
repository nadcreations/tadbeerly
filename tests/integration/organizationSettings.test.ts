import { beforeEach, describe, expect, test } from "vitest";
import "../setup/nextMocks";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents, organizations, users } from "@/db/schema";
import { setOrganizationMfaPolicy, updateOrganization } from "@/lib/organizationSettings";
import { AuthorizationError, ConflictError } from "@/lib/errors";
import { actorOf, adminFixture, makeAgent, makeOrg, resetDb } from "../setup/factories";

beforeEach(resetDb);

async function auditRows(orgId: string, action: string) {
  return db
    .select()
    .from(auditEvents)
    .where(and(eq(auditEvents.organizationId, orgId), eq(auditEvents.action, action)));
}
async function orgRow(id: string) {
  const [o] = await db.select().from(organizations).where(eq(organizations.id, id));
  return o;
}

describe("updateOrganization", () => {
  test("rename is trimmed and audited", async () => {
    const { org, admin } = await adminFixture("Meridian");
    await updateOrganization(actorOf(admin), { name: "  Meridian Group  " });
    expect((await orgRow(org.id)).name).toBe("Meridian Group");
    const [event] = await auditRows(org.id, "organization.updated");
    expect(event.metadata).toEqual({ from: "Meridian", to: "Meridian Group" });
  });

  test("unchanged name is a no-op without audit", async () => {
    const { org, admin } = await adminFixture("Meridian");
    await updateOrganization(actorOf(admin), { name: " Meridian " });
    expect(await auditRows(org.id, "organization.updated")).toHaveLength(0);
  });

  test("a case-insensitive duplicate is refused", async () => {
    const { org, admin } = await adminFixture("Meridian");
    await makeOrg("Kestrel Works");
    await expect(updateOrganization(actorOf(admin), { name: "kestrel WORKS" })).rejects.toThrow(
      "Another organization already uses that name.",
    );
    expect((await orgRow(org.id)).name).toBe("Meridian");
  });

  test("renaming to a different casing of its own name is allowed", async () => {
    const { org, admin } = await adminFixture("Meridian");
    await updateOrganization(actorOf(admin), { name: "MERIDIAN" });
    expect((await orgRow(org.id)).name).toBe("MERIDIAN");
  });

  test("name must be 2 to 120 characters", async () => {
    const { admin } = await adminFixture();
    await expect(updateOrganization(actorOf(admin), { name: " a " })).rejects.toBeInstanceOf(
      ConflictError,
    );
    await expect(
      updateOrganization(actorOf(admin), { name: "x".repeat(121) }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  test("requires admin.config", async () => {
    const { org } = await adminFixture();
    const agent = await makeAgent(org.id, "agent");
    await expect(
      updateOrganization(actorOf(agent, ["admin.users"]), { name: "Renamed" }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});

describe("setOrganizationMfaPolicy", () => {
  test("refused while the admin is unenrolled, allowed after enrolment", async () => {
    const { org, admin } = await adminFixture();
    await db.update(users).set({ mfaEnabled: false }).where(eq(users.id, admin.id));
    await expect(setOrganizationMfaPolicy(actorOf(admin), true)).rejects.toThrow(
      /Turn on two-factor authentication for your own account/,
    );
    expect((await orgRow(org.id)).requireMfa).toBe(false);
    await db.update(users).set({ mfaEnabled: true }).where(eq(users.id, admin.id));
    await setOrganizationMfaPolicy(actorOf(admin), true);
    expect((await orgRow(org.id)).requireMfa).toBe(true);
    const [event] = await auditRows(org.id, "organization.mfa_policy_changed");
    expect(event.metadata).toEqual({ require: true });
  });

  test("turning it off needs no enrolment; unchanged is a no-op", async () => {
    const { org, admin } = await adminFixture();
    await setOrganizationMfaPolicy(actorOf(admin), false);
    expect(await auditRows(org.id, "organization.mfa_policy_changed")).toHaveLength(0);
    await setOrganizationMfaPolicy(actorOf(admin), true);
    await db.update(users).set({ mfaEnabled: false }).where(eq(users.id, admin.id));
    await setOrganizationMfaPolicy(actorOf(admin), false);
    expect((await orgRow(org.id)).requireMfa).toBe(false);
    expect(await auditRows(org.id, "organization.mfa_policy_changed")).toHaveLength(2);
  });

  test("requires admin.config", async () => {
    const { org } = await adminFixture();
    const agent = await makeAgent(org.id, "agent");
    await expect(setOrganizationMfaPolicy(actorOf(agent, []), true)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });
});
