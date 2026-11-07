import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import "../setup/nextMocks";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents, invitations, organizations, users } from "@/db/schema";
import { inviteAgent, withdrawInvitation } from "@/lib/agents";
import { InvitationError, acceptInvitation, loadInvitation } from "@/lib/invitations";
import { createOrganizationWithAdmin } from "@/lib/organizations";
import { PasswordResetError } from "@/lib/passwordReset";
import { hashInvitationToken } from "@/lib/tokens";
import { verifyPassword } from "@/lib/password";
import { setTransportForTests } from "@/lib/email/transport";
import { acceptInvitationAction } from "@/lib/actions/invitations";
import { getCookie } from "../setup/nextMocks";
import { useSilentTransport } from "../setup/transport";
import {
  actorOf,
  adminFixture,
  count,
  makeAgent,
  notifications,
  resetDb,
  roleOf,
  userById,
} from "../setup/factories";

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

const GENERIC = "This invitation is invalid or has expired.";
const tokenOf = (url: string) => url.split("/invitations/")[1];

beforeEach(async () => {
  await resetDb();
  setTransportForTests({ name: "silent", send: async () => {} });
});
afterEach(() => useSilentTransport());

async function invite(email = "dan@meridian.example") {
  const { org, admin } = await adminFixture();
  const r = await inviteAgent(actorOf(admin), {
    email,
    firstName: "Dan",
    lastName: "K",
    roleId: (await roleOf(org.id, "agent")).id,
  });
  return { org, admin, userId: r.userId, token: tokenOf(r.invitationUrl) };
}

describe("loadInvitation", () => {
  test("describes a pending invitation", async () => {
    const { org, token } = await invite();
    expect(await loadInvitation(token)).toMatchObject({
      email: "dan@meridian.example",
      firstName: "Dan",
      organizationName: org.name,
    });
  });

  test("is null for unknown, expired, revoked, accepted and withdrawn tokens", async () => {
    expect(await loadInvitation("nope")).toBeNull();

    const { token, admin } = await invite();
    await db.update(invitations).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(invitations.tokenHash, hashInvitationToken(token)));
    expect(await loadInvitation(token)).toBeNull();

    await db.update(invitations).set({ expiresAt: new Date(Date.now() + 60_000), status: "revoked" }).where(eq(invitations.tokenHash, hashInvitationToken(token)));
    expect(await loadInvitation(token)).toBeNull();

    await db.update(invitations).set({ status: "accepted" }).where(eq(invitations.tokenHash, hashInvitationToken(token)));
    expect(await loadInvitation(token)).toBeNull();

    const second = await inviteAgent(actorOf(admin), {
      email: "eve@meridian.example",
      firstName: "Eve",
      lastName: "L",
      roleId: (await roleOf(admin.organizationId, "agent")).id,
    });
    await withdrawInvitation(actorOf(admin), second.userId);
    expect(await loadInvitation(tokenOf(second.invitationUrl))).toBeNull();
  });

  test("only a hash of the token is stored, and the raw token still works", async () => {
    const { userId, token } = await invite();
    const [row] = await db
      .select()
      .from(invitations)
      .where(eq(invitations.userId, userId));
    const stored = Object.values(row).filter((v) => typeof v === "string") as string[];
    expect(stored).not.toContain(token);
    expect(stored).toContain(createHash("sha256").update(token).digest("hex"));

    expect(await loadInvitation(token)).not.toBeNull();
    // The stored value is not itself a working link.
    const hash = createHash("sha256").update(token).digest("hex");
    expect(await loadInvitation(hash)).toBeNull();
    await expect(acceptInvitation(hash, "Password123!")).rejects.toThrow(GENERIC);
    await expect(acceptInvitation(token, "Password123!")).resolves.toMatchObject({ userId });
  });

  test("is null while the organization is suspended", async () => {
    const { org, token } = await invite();
    await db.update(organizations).set({ status: "suspended" }).where(eq(organizations.id, org.id));
    expect(await loadInvitation(token)).toBeNull();
  });
});

describe("acceptInvitation", () => {
  test("activates once and tells the inviter", async () => {
    const { admin, userId, token } = await invite();
    const result = await acceptInvitation(token, "Password123!");
    expect(result.userId).toBe(userId);

    const dan = await userById(userId);
    expect(dan.status).toBe("active");
    expect(await verifyPassword("Password123!", dan.passwordHash!)).toBe(true);

    const [inv] = await db.select().from(invitations).where(eq(invitations.tokenHash, hashInvitationToken(token)));
    expect(inv.status).toBe("accepted");
    expect(inv.respondedAt).not.toBeNull();

    await expect(acceptInvitation(token, "Another-pass-1")).rejects.toThrow(GENERIC);
    expect(await verifyPassword("Password123!", (await userById(userId)).passwordHash!)).toBe(true);

    const accepted = (await notifications()).filter((n) => n.kind === "invitation_accepted");
    expect(accepted.map((n) => [n.toEmail, n.recipientUserId])).toEqual([[admin.email, admin.id]]);
    expect(
      (await db.select({ a: auditEvents.action }).from(auditEvents)).map((r) => r.a),
    ).toContain("agent.activated");
  });

  test("concurrent acceptances: exactly one wins", async () => {
    const { token } = await invite();
    const results = await Promise.allSettled([
      acceptInvitation(token, "Password123!"),
      acceptInvitation(token, "Password456!"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await count(users, eq(users.status, "active"))).toBe(2);
  });

  test("expired and withdrawn invitations are refused", async () => {
    const { token, userId, admin } = await invite();
    await db.update(invitations).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(invitations.tokenHash, hashInvitationToken(token)));
    await expect(acceptInvitation(token, "Password123!")).rejects.toThrow(GENERIC);
    expect((await userById(userId)).status).toBe("invited");

    await db.update(invitations).set({ expiresAt: new Date(Date.now() + 60_000) }).where(eq(invitations.tokenHash, hashInvitationToken(token)));
    await withdrawInvitation(actorOf(admin), userId);
    await expect(acceptInvitation(token, "Password123!")).rejects.toThrow(GENERIC);
  });

  test("a weak password is refused with the reset rule and spends nothing", async () => {
    const { token, userId } = await invite();
    await expect(acceptInvitation(token, "short")).rejects.toBeInstanceOf(PasswordResetError);
    await expect(acceptInvitation(token, "x".repeat(201))).rejects.toBeInstanceOf(PasswordResetError);
    expect((await userById(userId)).status).toBe("invited");
    expect(await loadInvitation(token)).not.toBeNull();
  });

  test("a disabled-after-invite user cannot be activated by the link", async () => {
    const { token, userId } = await invite();
    await db.update(users).set({ status: "disabled" }).where(eq(users.id, userId));
    await expect(acceptInvitation(token, "Password123!")).rejects.toBeInstanceOf(InvitationError);
    const [inv] = await db.select().from(invitations).where(eq(invitations.tokenHash, hashInvitationToken(token)));
    expect(inv.status).toBe("pending");
  });

  test("a suspended organization's invitation is refused", async () => {
    const { org, token } = await invite();
    await db.update(organizations).set({ status: "suspended" }).where(eq(organizations.id, org.id));
    await expect(acceptInvitation(token, "Password123!")).rejects.toThrow(GENERIC);
  });

  test("the administrator invited by org:create can accept (no inviter to notify)", async () => {
    const created = await createOrganizationWithAdmin({
      name: "Meridian",
      admin: { email: "alice@meridian.example", firstName: "Alice", lastName: "A" },
    });
    const token = tokenOf(created.invitationUrl!);
    const [row] = await db.select().from(invitations);
    expect(Object.values(row)).not.toContain(token);
    expect((await loadInvitation(token))?.email).toBe("alice@meridian.example");
    await acceptInvitation(token, "Password123!");
    expect((await userById(created.adminUserId)).status).toBe("active");
    expect((await notifications()).filter((n) => n.kind === "invitation_accepted")).toEqual([]);
  });

  test("an inviter who has since been disabled is not emailed", async () => {
    const { org, admin, token } = await invite();
    await makeAgent(org.id, "administrator");
    await db.update(users).set({ status: "disabled" }).where(eq(users.id, admin.id));
    await acceptInvitation(token, "Password123!");
    expect((await notifications()).filter((n) => n.kind === "invitation_accepted")).toEqual([]);
  });
});

describe("migration 0002_hash_invitation_tokens", () => {
  const migration = readFileSync("drizzle/0002_hash_invitation_tokens.sql", "utf8");

  test("hashes tokens stored raw before the change, and only those", async () => {
    // A row as the old code wrote it: the raw token itself.
    const legacy = await invite("old@meridian.example");
    const raw = "Legacy_raw-token-0123456789abcdef";
    await db
      .update(invitations)
      .set({ tokenHash: raw })
      .where(eq(invitations.userId, legacy.userId));
    // A row as the new code writes it.
    const current = await invite("new@meridian.example");

    await db.execute(sql.raw(migration));
    expect(await loadInvitation(raw)).not.toBeNull();
    expect(await loadInvitation(current.token)).not.toBeNull();

    // Running it again changes nothing: a hash is never hashed twice.
    await db.execute(sql.raw(migration));
    expect(await loadInvitation(raw)).not.toBeNull();
    expect(await loadInvitation(current.token)).not.toBeNull();
    const [row] = await db
      .select()
      .from(invitations)
      .where(eq(invitations.userId, legacy.userId));
    expect(row.tokenHash).toBe(hashInvitationToken(raw));
  });
});

describe("acceptInvitationAction", () => {
  function form(token: string, password: string, confirm = password) {
    const fd = new FormData();
    fd.set("token", token);
    fd.set("password", password);
    fd.set("confirm", confirm);
    return fd;
  }

  test("signs the new agent in and sends them home", async () => {
    const { token, userId } = await invite();
    await expect(acceptInvitationAction({}, form(token, "Password123!"))).rejects.toThrow(
      "REDIRECT:/tickets",
    );
    expect(getCookie("tb_session")).toBeTruthy();
    expect((await userById(userId)).lastLoginAt).not.toBeNull();
  });

  test("a mismatched confirmation and a dead link are reported, not thrown", async () => {
    const { token } = await invite();
    expect(await acceptInvitationAction({}, form(token, "Password123!", "different"))).toMatchObject({
      fieldErrors: { confirm: expect.any(Array) },
    });
    expect(await acceptInvitationAction({}, form("nope", "Password123!"))).toEqual({ error: GENERIC });
    expect(await acceptInvitationAction({}, form(token, "short"))).toMatchObject({
      fieldErrors: { password: expect.any(Array) },
    });
  });
});
