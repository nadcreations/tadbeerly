import { beforeEach, describe, expect, test } from "vitest";
import "../setup/nextMocks";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents, roles } from "@/db/schema";
import { createRole, getRole, listRoles, updateRolePermissions } from "@/lib/rolesAdmin";
import { AuthorizationError, ConflictError, NotFoundError } from "@/lib/errors";
import { actorOf, adminFixture, count, makeAgent, makeOrg, resetDb, roleOf } from "../setup/factories";

beforeEach(resetDb);

async function auditRows(orgId: string, action: string) {
  return db
    .select()
    .from(auditEvents)
    .where(and(eq(auditEvents.organizationId, orgId), eq(auditEvents.action, action)))
    .orderBy(auditEvents.id);
}

describe("updateRolePermissions", () => {
  test("locked Administrator role cannot be edited", async () => {
    const { org, admin } = await adminFixture();
    const adminRole = await roleOf(org.id, "administrator");
    await expect(updateRolePermissions(actorOf(admin), adminRole.id, [])).rejects.toThrow(
      /always has every permission/,
    );
    expect((await roleOf(org.id, "administrator")).permissions.length).toBeGreaterThan(0);
  });

  test("unknown permission keys are dropped, duplicates removed, order canonical", async () => {
    const { org, admin } = await adminFixture();
    const sup = await roleOf(org.id, "supervisor");
    await updateRolePermissions(actorOf(admin), sup.id, [
      "admin.audit",
      "made.up",
      "admin.audit",
      "admin.users",
    ]);
    expect((await roleOf(org.id, "supervisor")).permissions).toEqual(["admin.users", "admin.audit"]);
  });

  test("audits added and removed", async () => {
    const { org, admin } = await adminFixture();
    const sup = await roleOf(org.id, "supervisor");
    await updateRolePermissions(actorOf(admin), sup.id, ["admin.audit"]);
    await updateRolePermissions(actorOf(admin), sup.id, ["admin.users"]);
    const rows = await auditRows(org.id, "role.permissions_updated");
    expect(rows).toHaveLength(2);
    expect(rows[1].metadata).toEqual({ added: ["admin.users"], removed: ["admin.audit"] });
  });

  test("requires admin.roles", async () => {
    const { org } = await adminFixture();
    const sup = await roleOf(org.id, "supervisor");
    const agent = await makeAgent(org.id, "agent");
    await expect(
      updateRolePermissions(actorOf(agent, ["admin.users"]), sup.id, ["admin.audit"]),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  test("a role from another organization is not found and unchanged", async () => {
    const { admin } = await adminFixture();
    const other = await makeOrg("Kestrel Works");
    const foreign = await roleOf(other.id, "supervisor");
    await expect(
      updateRolePermissions(actorOf(admin), foreign.id, ["admin.audit"]),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect((await roleOf(other.id, "supervisor")).permissions).toEqual(foreign.permissions);
  });
});

describe("getRole and listRoles", () => {
  test("roles from another organization are not found", async () => {
    const { org } = await adminFixture();
    const other = await makeOrg("Kestrel Works");
    const foreign = await roleOf(other.id, "supervisor");
    await expect(getRole(org.id, foreign.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await getRole(other.id, foreign.id)).id).toBe(foreign.id);
  });

  test("lists the organization's roles with member counts", async () => {
    const { org } = await adminFixture();
    await makeAgent(org.id, "agent");
    await makeAgent(org.id, "agent");
    const list = await listRoles(org.id);
    expect(list.find((r) => r.key === "administrator")?.memberCount).toBe(1);
    expect(list.find((r) => r.key === "agent")?.memberCount).toBe(2);
    expect(list.find((r) => r.key === "supervisor")?.memberCount).toBe(0);
    expect(list.every((r) => r.organizationId === org.id)).toBe(true);
  });
});

describe("createRole", () => {
  test("copies permissions, is custom, and audits", async () => {
    const { org, admin } = await adminFixture();
    const sup = await roleOf(org.id, "supervisor");
    await updateRolePermissions(actorOf(admin), sup.id, ["admin.users", "admin.audit"]);
    const { roleId } = await createRole(actorOf(admin), {
      name: "  Night  Shift Lead! ",
      description: "Covers nights",
      copyFromRoleId: sup.id,
    });
    const [created] = await db.select().from(roles).where(eq(roles.id, roleId));
    expect(created.key).toBe("custom_night_shift_lead");
    expect(created.name).toBe("Night  Shift Lead!");
    expect(created.permissions).toEqual(["admin.users", "admin.audit"]);
    expect(created.isSystem).toBe(false);
    expect(created.isLocked).toBe(false);
    expect(created.organizationId).toBe(org.id);
    const [event] = await auditRows(org.id, "role.created");
    expect(event.metadata).toEqual({ copiedFrom: sup.id });
  });

  test("a duplicate name is a conflict", async () => {
    const { org, admin } = await adminFixture();
    const sup = await roleOf(org.id, "supervisor");
    await createRole(actorOf(admin), { name: "Lead", copyFromRoleId: sup.id });
    await expect(
      createRole(actorOf(admin), { name: "LEAD", copyFromRoleId: sup.id }),
    ).rejects.toThrow("A role with that name already exists.");
  });

  test("a name must be 2 to 60 characters", async () => {
    const { org, admin } = await adminFixture();
    const sup = await roleOf(org.id, "supervisor");
    await expect(
      createRole(actorOf(admin), { name: " a ", copyFromRoleId: sup.id }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      createRole(actorOf(admin), { name: "x".repeat(61), copyFromRoleId: sup.id }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  test("copyFromRoleId in another organization is not found and nothing is created", async () => {
    const { org, admin } = await adminFixture();
    const other = await makeOrg("Kestrel Works");
    const foreign = await roleOf(other.id, "supervisor");
    const before = await count(roles, eq(roles.organizationId, org.id));
    await expect(
      createRole(actorOf(admin), { name: "Sneaky", copyFromRoleId: foreign.id }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(await count(roles, eq(roles.organizationId, org.id))).toBe(before);
  });

  test("requires admin.roles", async () => {
    const { org } = await adminFixture();
    const sup = await roleOf(org.id, "supervisor");
    const agent = await makeAgent(org.id, "agent");
    await expect(
      createRole(actorOf(agent, []), { name: "Nope", copyFromRoleId: sup.id }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});

describe("createRole slug", () => {
  test("a name with no letters or digits is refused", async () => {
    const { org, admin } = await adminFixture();
    const sup = await roleOf(org.id, "supervisor");
    await expect(
      createRole(actorOf(admin), { name: "!!", copyFromRoleId: sup.id }),
    ).rejects.toThrow("Use at least one letter or number in the role name.");
  });
});
