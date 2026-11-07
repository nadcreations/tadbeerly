"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { authenticate } from "@/lib/auth";
import { homeFor } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";
import { fullName, normaliseEmail } from "@/lib/format";
import { createSession, destroySession, getCurrentUser } from "@/lib/session";
import { fieldErrorsFrom, type ActionState } from "./types";

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
});

export async function login(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { fieldErrors: fieldErrorsFrom(parsed.error.flatten().fieldErrors) };
  }
  const { email, password } = parsed.data;

  const result = await authenticate(email, password);

  if (result.status === "locked") {
    return { error: "Too many attempts. Try again in 15 minutes." };
  }

  if (result.status === "invalid") {
    // Audit rows need an organization, so an unknown email is not recorded.
    const [account] = await db
      .select({ id: users.id, organizationId: users.organizationId })
      .from(users)
      .where(sql`lower(${users.email}) = ${normaliseEmail(email)}`)
      .limit(1);
    if (account) {
      await recordAudit({
        action: "auth.login_failed",
        summary: `Failed sign-in attempt for ${normaliseEmail(email)}`,
        organizationId: account.organizationId,
        actorUserId: account.id,
        entityType: "user",
        entityId: account.id,
      });
    }
    return { error: "Email or password is incorrect." };
  }

  const { user } = result;
  // MFA challenge branch: added in Task 10, before the session is created.

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
  });

  await createSession(user.id);
  redirect(homeFor(row));
}

export async function logout(): Promise<void> {
  const user = await getCurrentUser();
  if (user) {
    await recordAudit({
      action: "auth.logout",
      summary: `${fullName(user)} signed out`,
      organizationId: user.organizationId,
      actorUserId: user.id,
      entityType: "user",
      entityId: user.id,
    });
  }
  await destroySession();
  redirect("/login");
}
