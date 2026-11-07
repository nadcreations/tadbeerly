import { setHeaders } from "../setup/nextMocks";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { db } from "@/db";
import { auditEvents } from "@/db/schema";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import { auditActionLabel, listAuditActorOptions, listAuditEvents, parseDayBound } from "@/lib/auditQueries";
import { createOrganizationWithAdmin } from "@/lib/organizations";
import { count, makeAgent, makeOrg, makeRequester, resetDb } from "../setup/factories";

beforeEach(async () => {
  setHeaders({});
  await resetDb();
});

const rowsOf = (orgId: string) =>
  db.select().from(auditEvents).where(eq(auditEvents.organizationId, orgId));

describe("audit trail", () => {
  test("audit is scoped to the organization", async () => {
    const [a, b] = [await makeOrg("A"), await makeOrg("B")];
    await recordAudit({ action: "organization.updated", summary: "A", organizationId: a.id });
    await recordAudit({ action: "organization.updated", summary: "B", organizationId: b.id });
    const res = await listAuditEvents(a.id, {}, 1);
    expect(res.rows.map((r) => r.summary)).toEqual(["A"]);
  });

  test("page is clamped to the last page", async () => {
    const a = await makeOrg();
    for (let i = 0; i < 145; i++) await recordAudit({ action: "organization.updated", summary: `e${i}`, organizationId: a.id });
    const res = await listAuditEvents(a.id, {}, 99);
    expect(res.page).toBe(2);
    expect(res.total).toBe(145);
    expect(res.rows).toHaveLength(45);
    expect(res.pageSize).toBe(100);
    expect((await listAuditEvents(a.id, {}, -3)).page).toBe(1);
  });

  test("empty trail gives page 1", async () => {
    const a = await makeOrg();
    const res = await listAuditEvents(a.id, {}, 5);
    expect(res).toMatchObject({ rows: [], total: 0, page: 1 });
  });

  test("audit write failure does not throw", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(recordAudit({ action: "organization.updated", summary: "x", organizationId: "00000000-0000-0000-0000-000000000000" })).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  test("newest first with id tiebreak, and actor name", async () => {
    const a = await makeOrg();
    const u = await makeAgent(a.id);
    await recordAudit({ action: "auth.login", summary: "first", organizationId: a.id, actorUserId: u.id });
    await recordAudit({ action: "auth.logout", summary: "second", organizationId: a.id });
    await db.update(auditEvents).set({ occurredAt: new Date("2026-01-01T00:00:00Z") });
    const res = await listAuditEvents(a.id, {}, 1);
    expect(res.rows.map((r) => r.summary)).toEqual(["second", "first"]);
    expect(res.rows[1].actorName).toBe(`${u.firstName} ${u.lastName}`);
    expect(res.rows[0].actorName).toBeNull();
  });

  test("filters: action, actor, inclusive from/to", async () => {
    const a = await makeOrg();
    const u = await makeAgent(a.id);
    await recordAudit({ action: "auth.login", summary: "l", organizationId: a.id, actorUserId: u.id });
    await recordAudit({ action: "auth.logout", summary: "o", organizationId: a.id });
    await recordAudit({ action: "auth.login_failed", summary: "f", organizationId: a.id });
    expect((await listAuditEvents(a.id, { action: "auth.login" }, 1)).rows.map((r) => r.summary)).toEqual(["l"]);
    expect((await listAuditEvents(a.id, { actorUserId: u.id }, 1)).rows.map((r) => r.summary)).toEqual(["l"]);
    const t1 = new Date("2026-03-01T10:00:00Z");
    const t2 = new Date("2026-03-02T10:00:00Z");
    const t3 = new Date("2026-03-03T10:00:00Z");
    const all = await rowsOf(a.id);
    for (const [i, t] of [t1, t2, t3].entries()) await db.update(auditEvents).set({ occurredAt: t }).where(eq(auditEvents.id, all[i].id));
    expect((await listAuditEvents(a.id, { from: t2, to: t2 }, 1)).total).toBe(1);
    expect((await listAuditEvents(a.id, { from: t2 }, 1)).total).toBe(2);
    expect((await listAuditEvents(a.id, { to: t2 }, 1)).total).toBe(2);
  });

  test("ip comes from x-forwarded-for; malformed becomes null", async () => {
    const a = await makeOrg();
    setHeaders({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" });
    await recordAudit({ action: "auth.login", summary: "ok", organizationId: a.id });
    setHeaders({ "x-forwarded-for": "2001:db8::1" });
    await recordAudit({ action: "auth.login", summary: "v6", organizationId: a.id });
    setHeaders({ "x-forwarded-for": "not-an-ip" });
    await recordAudit({ action: "auth.login", summary: "bad", organizationId: a.id });
    const by = Object.fromEntries((await rowsOf(a.id)).map((r) => [r.summary, r.ipAddress]));
    expect(by.ok).toBe("203.0.113.9");
    expect(by.v6).toBe("2001:db8::1");
    expect(by.bad).toBeNull();
    expect(await count(auditEvents)).toBe(3);
  });

  test("labels cover every action; unknown falls back", () => {
    expect(auditActionLabel("agent.invited")).toBe("Agent invited");
    expect(auditActionLabel("weird.thing")).toBe("weird.thing");
    for (const act of AUDIT_ACTIONS) expect(auditActionLabel(act)).not.toBe(act);
  });

  test("createOrganizationWithAdmin records organization.created", async () => {
    const r = await createOrganizationWithAdmin({ name: "Meridian", admin: { email: "a@m.example", firstName: "A", lastName: "B", password: "Password123!" } });
    const [row] = await rowsOf(r.organizationId);
    expect(row).toMatchObject({ action: "organization.created", summary: "Organization Meridian created", actorUserId: null, entityType: "organization", entityId: r.organizationId, metadata: { adminUserId: r.adminUserId } });
  });
});

describe("audit page helpers", () => {
  test("a to date includes the whole day", async () => {
    const a = await makeOrg();
    await db.insert(auditEvents).values([
      { action: "organization.updated", summary: "late", organizationId: a.id, occurredAt: new Date("2026-03-05T23:30:00.000Z") },
      { action: "organization.updated", summary: "next", organizationId: a.id, occurredAt: new Date("2026-03-06T00:00:00.000Z") },
    ]);
    const to = parseDayBound("2026-03-05", "end")!;
    const res = await listAuditEvents(a.id, { to }, 1);
    expect(res.rows.map((r) => r.summary)).toEqual(["late"]);
    expect(parseDayBound("2026-03-05", "start")!.toISOString()).toBe("2026-03-05T00:00:00.000Z");
  });

  test("invalid dates are ignored", () => {
    for (const bad of [undefined, "", "tomorrow", "2026-02-30", "2026-3-5"]) {
      expect(parseDayBound(bad, "end")).toBeNull();
    }
  });

  test("actor options are the organization's agents only", async () => {
    const a = await makeOrg("A");
    const b = await makeOrg("B");
    const mine = await makeAgent(a.id, "agent");
    await makeAgent(b.id, "agent");
    await makeRequester(a.id);
    const options = await listAuditActorOptions(a.id);
    expect(options.map((o) => o.id)).toEqual([mine.id]);
  });
});

describe("audit actor filter", () => {
  test("a non-uuid actor is ignored rather than erroring", async () => {
    const a = await makeOrg();
    await recordAudit({ action: "organization.updated", summary: "x", organizationId: a.id });
    const res = await listAuditEvents(a.id, { actorUserId: "abc" }, 1);
    expect(res.rows.map((r) => r.summary)).toEqual(["x"]);
  });
});
