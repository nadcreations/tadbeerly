import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "vitest";
import { db } from "@/db";
import { invitations, roles } from "@/db/schema";
import { syncRoles } from "@/db/syncRoles";
import { createOrganizationWithAdmin } from "@/lib/organizations";
import { ALL_PERMISSIONS } from "@/lib/permissions";
import { count, resetDb, roleOf, userById } from "../setup/factories";

beforeEach(resetDb);

const rolesOf = (orgId: string) =>
  db.select().from(roles).where(eq(roles.organizationId, orgId));

describe("organizations", () => {
  test("each organization gets its own copy of every template", async () => {
    const a = await createOrganizationWithAdmin({ name: "Meridian", admin: { email: " Alice@Meridian.example ", firstName: "Alice", lastName: "Ng", password: "Password123!" } });
    const b = await createOrganizationWithAdmin({ name: "Kestrel", admin: { email: "bob@kestrel.example", firstName: "Bob", lastName: "Li", password: "Password123!" } });
    expect((await rolesOf(a.organizationId)).map((r) => r.key).sort()).toEqual(["administrator", "agent", "read_only", "supervisor"]);
    await db.update(roles).set({ permissions: [] }).where(and(eq(roles.organizationId, a.organizationId), eq(roles.key, "administrator")));
    expect((await roleOf(b.organizationId, "administrator")).permissions).toEqual([...ALL_PERMISSIONS]);
    expect((await userById(a.adminUserId)).email).toBe("alice@meridian.example");
    expect((await userById(a.adminUserId)).status).toBe("active");
  });

  test("admin without password is invited", async () => {
    const r = await createOrganizationWithAdmin({ name: "Northbank", admin: { email: "n@nb.example", firstName: "N", lastName: "B" } });
    expect(r.invitationUrl).toMatch(/\/invitations\//);
    const user = await userById(r.adminUserId);
    expect(user.status).toBe("invited");
    expect(user.passwordHash).toBeNull();
    expect(await count(invitations)).toBe(1);
  });

  test("syncRoles grants missing keys and keeps custom ones", async () => {
    const a = await createOrganizationWithAdmin({ name: "Meridian", admin: { email: "a@m.example", firstName: "A", lastName: "B", password: "Password123!" } });
    const [first, ...rest] = ALL_PERMISSIONS;
    await db.update(roles).set({ permissions: [...rest, "custom.x"] }).where(and(eq(roles.organizationId, a.organizationId), eq(roles.key, "administrator")));
    const { updated } = await syncRoles();
    expect(updated).toBe(1);
    const perms = (await roleOf(a.organizationId, "administrator")).permissions;
    expect(perms).toContain(first);
    expect(perms).toContain("custom.x");
  });
});
