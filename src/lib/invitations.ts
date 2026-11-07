import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { invitations, organizations, users } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { dispatchSoon, enqueue, recipientsByUserIds } from "@/lib/email/outbox";
import { invitationAcceptedEmail } from "@/lib/email/templates";
import { fullName } from "@/lib/format";
import { hashPassword } from "@/lib/password";
import { validateNewPassword } from "@/lib/passwordReset";

export const INVALID_INVITATION_MESSAGE = "This invitation is invalid or has expired.";

/** One generic failure for every way a link can be unusable, so it reveals nothing. */
export class InvitationError extends Error {
  constructor(message = INVALID_INVITATION_MESSAGE) {
    super(message);
    this.name = "InvitationError";
  }
}

export type LoadedInvitation = {
  email: string;
  firstName: string;
  lastName: string;
  organizationName: string;
};

/**
 * What the acceptance page shows. Null for anything not usable: unknown,
 * expired, revoked, accepted, withdrawn (the user row is gone), or an
 * organization that is not active.
 */
export async function loadInvitation(token: string): Promise<LoadedInvitation | null> {
  const [row] = await db
    .select({
      email: invitations.email,
      firstName: users.firstName,
      lastName: users.lastName,
      organizationName: organizations.name,
    })
    .from(invitations)
    .innerJoin(users, eq(users.id, invitations.userId))
    .innerJoin(organizations, eq(organizations.id, invitations.organizationId))
    .where(
      and(
        eq(invitations.token, token),
        eq(invitations.status, "pending"),
        sql`${invitations.expiresAt} > now()`,
        eq(users.status, "invited"),
        eq(organizations.status, "active"),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Spends the invitation, sets the password and activates the account, all or
 * nothing. The spend is one conditional UPDATE, so parallel submissions cannot
 * both succeed. Signing the person in is the caller's job (see the action).
 */
export async function acceptInvitation(
  token: string,
  password: string,
): Promise<{ userId: string; organizationId: string }> {
  validateNewPassword(password);
  const passwordHash = await hashPassword(password);

  const user = await db.transaction(async (tx) => {
    const [invitation] = await tx
      .update(invitations)
      .set({ status: "accepted", respondedAt: sql`now()` })
      .where(
        and(
          eq(invitations.token, token),
          eq(invitations.status, "pending"),
          sql`${invitations.expiresAt} > now()`,
          sql`exists (
            select 1 from ${organizations}
            where ${organizations.id} = ${invitations.organizationId}
              and ${organizations.status} = 'active'
          )`,
        ),
      )
      .returning({
        userId: invitations.userId,
        organizationId: invitations.organizationId,
        createdByUserId: invitations.createdByUserId,
      });
    if (!invitation) throw new InvitationError();

    const [activated] = await tx
      .update(users)
      .set({ passwordHash, status: "active", updatedAt: new Date() })
      .where(
        and(
          eq(users.id, invitation.userId),
          eq(users.organizationId, invitation.organizationId),
          eq(users.status, "invited"),
          isNull(users.passwordHash),
        ),
      )
      .returning({
        id: users.id,
        organizationId: users.organizationId,
        firstName: users.firstName,
        lastName: users.lastName,
      });
    // Disabled or otherwise changed since the invite: roll back, link stays as it was.
    if (!activated) throw new InvitationError();

    if (invitation.createdByUserId) {
      const [organization] = await tx
        .select({ name: organizations.name })
        .from(organizations)
        .where(eq(organizations.id, activated.organizationId));
      const recipients = await recipientsByUserIds(
        activated.organizationId,
        [invitation.createdByUserId],
        tx,
      );
      await enqueue(
        tx,
        recipients.map((inviter) => ({
          kind: "invitation_accepted" as const,
          content: invitationAcceptedEmail({
            name: fullName(activated),
            organizationName: organization.name,
          }),
          toEmail: inviter.email,
          toName: inviter.name,
          organizationId: activated.organizationId,
          recipientUserId: inviter.userId,
          entityType: "user",
          entityId: activated.id,
        })),
      );
    }
    return activated;
  });

  await recordAudit({
    action: "agent.activated",
    summary: `${fullName(user)} accepted their invitation and activated their account`,
    organizationId: user.organizationId,
    actorUserId: user.id,
    entityType: "user",
    entityId: user.id,
  });
  await dispatchSoon();
  return { userId: user.id, organizationId: user.organizationId };
}
