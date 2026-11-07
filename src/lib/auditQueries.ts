import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents, users } from "@/db/schema";
import type { AuditAction } from "@/lib/audit";

const PAGE_SIZE = 100 as const;

export type AuditFilters = {
  /** Exact action key. */
  action?: string;
  /** Exact actor. */
  actorUserId?: string;
  /** Inclusive bounds on occurredAt. */
  from?: Date;
  to?: Date;
};

export type AuditRow = {
  id: number;
  occurredAt: Date;
  action: string;
  summary: string;
  entityType: string | null;
  entityId: string | null;
  ipAddress: string | null;
  metadata: Record<string, unknown>;
  actorUserId: string | null;
  actorName: string | null;
};

const LABELS: Record<AuditAction, string> = {
  "auth.login": "Signed in",
  "auth.login_failed": "Sign-in failed",
  "auth.logout": "Signed out",
  "auth.mfa_enrolment_started": "Two-factor enrolment started",
  "auth.mfa_enrolled": "MFA enrolled",
  "auth.mfa_disabled": "MFA disabled",
  "auth.mfa_reset": "MFA reset",
  "auth.recovery_codes_regenerated": "Recovery codes regenerated",
  "auth.password_reset_issued": "Password reset issued",
  "auth.password_reset_requested": "Password reset requested",
  "auth.password_reset_completed": "Password reset completed",
  "organization.created": "Organization created",
  "organization.updated": "Organization updated",
  "organization.mfa_policy_changed": "MFA policy changed",
  "agent.invited": "Agent invited",
  "agent.invitation_resent": "Invitation resent",
  "agent.invitation_withdrawn": "Invitation withdrawn",
  "agent.activated": "Agent activated",
  "agent.role_changed": "Agent role changed",
  "agent.disabled": "Agent disabled",
  "agent.enabled": "Agent enabled",
  "role.created": "Role created",
  "role.permissions_updated": "Role permissions updated",
};

/** Human label for an action key; unknown keys fall back to the raw key. */
export function auditActionLabel(action: string): string {
  return Object.hasOwn(LABELS, action) ? LABELS[action as AuditAction] : action;
}

export async function listAuditEvents(
  organizationId: string,
  filters: AuditFilters,
  page: number,
): Promise<{ rows: AuditRow[]; total: number; page: number; pageSize: 100 }> {
  const where = and(
    eq(auditEvents.organizationId, organizationId),
    filters.action ? eq(auditEvents.action, filters.action) : undefined,
    filters.actorUserId ? eq(auditEvents.actorUserId, filters.actorUserId) : undefined,
    filters.from ? gte(auditEvents.occurredAt, filters.from) : undefined,
    filters.to ? lte(auditEvents.occurredAt, filters.to) : undefined,
  );

  const [totalRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(auditEvents)
    .where(where);
  const total = totalRow?.n ?? 0;

  // Clamp before offsetting so a stale page number never yields an empty table.
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(Math.max(1, Math.trunc(page) || 1), lastPage);

  const rows = await db
    .select({
      id: auditEvents.id,
      occurredAt: auditEvents.occurredAt,
      action: auditEvents.action,
      summary: auditEvents.summary,
      entityType: auditEvents.entityType,
      entityId: auditEvents.entityId,
      ipAddress: auditEvents.ipAddress,
      metadata: auditEvents.metadata,
      actorUserId: auditEvents.actorUserId,
      actorName: sql<string | null>`case when ${users.id} is null then null else ${users.firstName} || ' ' || ${users.lastName} end`,
    })
    .from(auditEvents)
    .leftJoin(users, eq(users.id, auditEvents.actorUserId))
    .where(where)
    .orderBy(desc(auditEvents.occurredAt), desc(auditEvents.id))
    .limit(PAGE_SIZE)
    .offset((safePage - 1) * PAGE_SIZE);

  return { rows, total, page: safePage, pageSize: PAGE_SIZE };
}

/**
 * Parses a yyyy-mm-dd query value into a bound on occurredAt. "end" is the last
 * millisecond of that day (UTC), so a `to` filter includes the whole day.
 * Anything that is not a real calendar date is ignored.
 */
export function parseDayBound(raw: string | undefined, edge: "start" | "end"): Date | null {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const start = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || start.toISOString().slice(0, 10) !== raw) return null;
  return edge === "start" ? start : new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
}

/** Every agent of the organization, for the actor filter. */
export async function listAuditActorOptions(
  organizationId: string,
): Promise<{ id: string; name: string }[]> {
  const rows = await db
    .select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
    .from(users)
    .where(and(eq(users.organizationId, organizationId), eq(users.kind, "agent")))
    .orderBy(users.firstName, users.lastName);
  return rows.map((r) => ({ id: r.id, name: `${r.firstName} ${r.lastName}` }));
}
