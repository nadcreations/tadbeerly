import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { homeFor } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";
import { fullName } from "@/lib/format";
import { createSession } from "@/lib/session";

/**
 * The one place a sign-in is completed, shared by the password-only path and
 * the second-factor path so the two cannot drift. It lives outside
 * `actions/*` on purpose: anything exported from a "use server" file is a
 * public endpoint, and this one issues a session for any user id.
 *
 * Callers must have fully authenticated `user` (and re-checked that the
 * account and organization are active) before calling.
 */
export async function completeSignIn(
  user: { id: string; organizationId: string },
  options: { mfa?: boolean } = {},
): Promise<never> {
  // Session first: if it fails, nothing claims the user signed in.
  await createSession(user.id);

  const [row] = await db
    .update(users)
    .set({ lastLoginAt: new Date() })
    .where(eq(users.id, user.id))
    .returning({ firstName: users.firstName, lastName: users.lastName, kind: users.kind });

  await recordAudit({
    action: "auth.login",
    summary: `${fullName(row)} signed in`,
    organizationId: user.organizationId,
    actorUserId: user.id,
    entityType: "user",
    entityId: user.id,
    ...(options.mfa ? { metadata: { mfa: true } } : {}),
  });
  redirect(homeFor(row));
}
