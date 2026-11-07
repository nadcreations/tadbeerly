import { isIP } from "node:net";
import { headers } from "next/headers";
import { db } from "@/db";
import { auditEvents } from "@/db/schema";

export const AUDIT_ACTIONS = [
  "auth.login",
  "auth.login_failed",
  "auth.logout",
  "auth.mfa_enrolment_started",
  "auth.mfa_enrolled",
  "auth.mfa_disabled",
  "auth.mfa_reset",
  "auth.recovery_codes_regenerated",
  "auth.password_reset_issued",
  "auth.password_reset_requested",
  "auth.password_reset_completed",
  "organization.created",
  "organization.updated",
  "organization.mfa_policy_changed",
  "agent.invited",
  "agent.invitation_resent",
  "agent.invitation_withdrawn",
  "agent.activated",
  "agent.role_changed",
  "agent.disabled",
  "agent.enabled",
  "role.created",
  "role.permissions_updated",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

type RecordAuditInput = {
  action: AuditAction;
  summary: string;
  organizationId: string;
  actorUserId?: string | null;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
};

/** First x-forwarded-for entry if it is a valid IP; otherwise null. */
async function requestIp(): Promise<string | null> {
  try {
    const headerList = await headers();
    const first = headerList.get("x-forwarded-for")?.split(",")[0]?.trim();
    return first && isIP(first) ? first : null;
  } catch {
    // Outside a request context (e.g. scripts) there are no headers.
    return null;
  }
}

/**
 * Appends an audit event. Never throws into the caller: an audit write failing
 * must not roll back or block the business action it describes, but it must be
 * loud in the logs because the trail is evidentiary.
 */
export async function recordAudit(input: RecordAuditInput): Promise<void> {
  try {
    await db.insert(auditEvents).values({
      action: input.action,
      summary: input.summary,
      organizationId: input.organizationId,
      actorUserId: input.actorUserId ?? null,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      metadata: input.metadata ?? {},
      ipAddress: await requestIp(),
    });
  } catch (error) {
    console.error("[audit] failed to record event", input.action, error);
  }
}
