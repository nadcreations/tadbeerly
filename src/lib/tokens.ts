import { randomBytes } from "node:crypto";

/** URL-safe, unguessable invitation token. */
export function generateInvitationToken(): string {
  return randomBytes(24).toString("base64url");
}

export const INVITATION_TTL_DAYS = 30;

export function invitationExpiry(days = INVITATION_TTL_DAYS): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

export function invitationUrl(token: string): string {
  const base = process.env.APP_URL ?? "http://localhost:3000";
  return `${base.replace(/\/$/, "")}/invitations/${token}`;
}
