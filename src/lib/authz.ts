import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { mfaGateRedirect } from "@/lib/mfa";
import { getCurrentUser, type SessionUser } from "@/lib/session";
import { hasPermission, type Permission } from "@/lib/permissions";
import { AuthorizationError } from "@/lib/errors";

export { AuthorizationError };

/** What a service needs to know about who is acting. */
export type Actor = Pick<SessionUser, "id" | "organizationId" | "permissions">;

export function can(user: Pick<SessionUser, "permissions">, p: Permission): boolean {
  return hasPermission(user.permissions, p);
}

/** For services: throws when the actor lacks the permission. */
export function assertCan(actor: Actor, p: Permission): void {
  if (!can(actor, p)) throw new AuthorizationError();
}

export function homeFor(user: Pick<SessionUser, "kind">): "/tickets" | "/portal" {
  return user.kind === "agent" ? "/tickets" : "/portal";
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/**
 * Agents only; requesters are sent to their portal. This is also where the MFA
 * gate is enforced: a layout is not re-rendered on client navigation and server
 * actions run before any layout, so the check has to live with the data access.
 * The security page and the MFA actions use requireUser and stay reachable.
 * A missing pathname header fails closed (the gate then applies).
 */
export async function requireAgent(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.kind !== "agent") redirect("/portal");
  const pathname = (await headers()).get("x-tb-pathname") ?? "";
  const gate = mfaGateRedirect(user, pathname);
  if (gate) redirect(gate);
  return user;
}

/** For server actions: throws AuthorizationError without the permission. */
export async function requirePermission(p: Permission): Promise<SessionUser> {
  const user = await requireAgent();
  if (!can(user, p)) throw new AuthorizationError();
  return user;
}

/** For pages: renders a 404 without the permission. */
export async function requirePagePermission(p: Permission): Promise<SessionUser> {
  const user = await requireAgent();
  if (!can(user, p)) notFound();
  return user;
}
