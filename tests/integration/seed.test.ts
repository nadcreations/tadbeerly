import { eq } from "drizzle-orm";
import { afterEach, describe, expect, test } from "vitest";
import { db } from "@/db";
import { auditEvents, emailNotifications, invitations, organizations, users } from "@/db/schema";
import { seed } from "@/db/seed";
import { truncateAllTables } from "@/db/truncate";
import { listAgents } from "@/lib/agents";
import { verifyPassword } from "@/lib/password";
import { count, orgByName, roleOf } from "../setup/factories";

const realUrl = process.env.DATABASE_URL;
afterEach(() => {
  process.env.DATABASE_URL = realUrl;
});

describe("seed", () => {
  test("is repeatable and keeps tenants apart", async () => {
    await seed();
    await seed();
    expect(await count(organizations)).toBe(2);
    const kestrel = await orgByName("Kestrel Services");
    expect((await listAgents(kestrel.id, {}, 1)).rows.map((r) => r.email)).toEqual([
      "bob@kestrel.example",
    ]);
    const meridian = await orgByName("Meridian Group");
    const rows = (await listAgents(meridian.id, {}, 1)).rows;
    expect(rows.map((r) => r.email).sort()).toEqual([
      "alice@meridian.example",
      "carol@meridian.example",
      "dan@meridian.example",
      "erin@meridian.example",
      "frank@meridian.example",
      "gina@meridian.example",
    ]);
  });

  test("accounts, roles, invitation, audit and an empty outbox", async () => {
    await seed();
    const meridian = await orgByName("Meridian Group");
    const byEmail = async (email: string) =>
      (await db.select().from(users).where(eq(users.email, email)))[0];

    const alice = await byEmail("alice@meridian.example");
    expect(alice.roleId).toBe((await roleOf(meridian.id, "administrator")).id);
    expect(alice.mfaEnabled).toBe(false);
    expect(await verifyPassword("Password123!", alice.passwordHash!)).toBe(true);
    expect((await byEmail("frank@meridian.example")).roleId).toBe(
      (await roleOf(meridian.id, "read_only")).id,
    );
    expect((await byEmail("carol@meridian.example")).roleId).toBe(
      (await roleOf(meridian.id, "supervisor")).id,
    );

    const gina = await byEmail("gina@meridian.example");
    expect(gina.status).toBe("invited");
    expect(gina.passwordHash).toBeNull();
    const pending = await db.select().from(invitations).where(eq(invitations.userId, gina.id));
    expect(pending.map((i) => i.status)).toEqual(["pending"]);

    expect(await count(auditEvents)).toBe(25);
    expect(await count(emailNotifications)).toBe(0);
  });

  test("refuses any database that is not local, and truncates nothing", async () => {
    await seed();
    process.env.DATABASE_URL = "postgresql://u:p@db.example.com:5432/prod";
    await expect(seed()).rejects.toThrow(/localhost|127.0.0.1/);
    process.env.DATABASE_URL = realUrl;
    expect(await count(organizations)).toBe(2);
    expect(await count(auditEvents)).toBe(25);
  });

  test("truncateAllTables refuses a non-local database and leaves data intact", async () => {
    await seed();
    process.env.DATABASE_URL = "postgresql://u:p@db.example.com:5432/prod";
    await expect(truncateAllTables()).rejects.toThrow(/Refusing/);
    process.env.DATABASE_URL = realUrl;
    expect(await count(organizations)).toBe(2);
    expect(await count(auditEvents)).toBe(25);
  });
});
