import { createHash, randomBytes } from "node:crypto";

/**
 * URL-safe, unguessable invitation token. It appears only in the link; the
 * database holds hashInvitationToken(token).
 */
export function generateInvitationToken(): string {
  return randomBytes(24).toString("base64url");
}

/**
 * What is stored for an invitation token, and what a link is looked up by.
 * Hashed like session and reset tokens, so a copy of the database holds no
 * working invitation links.
 */
export function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export const INVITATION_TTL_DAYS = 30;

export function invitationExpiry(days = INVITATION_TTL_DAYS): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

export function invitationUrl(token: string): string {
  const base = process.env.APP_URL ?? "http://localhost:3000";
  return `${base.replace(/\/$/, "")}/invitations/${token}`;
}
