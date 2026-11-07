import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { organizations, users } from "@/db/schema";
import { normaliseEmail } from "@/lib/format";
import { hashPassword, verifyPassword } from "@/lib/password";
import { clearRateLimit, hitRateLimit, isRateLimited } from "@/lib/rateLimit";

export const LOGIN_FAILURE_LIMIT = 10;
export const LOGIN_WINDOW_SECONDS = 15 * 60;

export type AuthResult =
  | { status: "ok"; user: { id: string; organizationId: string; mfaEnabled: boolean } }
  | { status: "invalid"; account?: { id: string; organizationId: string } }
  | { status: "locked" };

/** Verified when there is no usable account, so the scrypt cost is always paid. */
let dummyHash: Promise<string> | undefined;
function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword("tadbeerly-dummy-password").catch((error) => {
    dummyHash = undefined; // never cache a rejection
    throw error;
  });
  return dummyHash;
}
// Computed eagerly so the first unknown-email request does not pay for it.
void getDummyHash().catch(() => {});

/**
 * Checks an email and password. Only failures are counted against the email
 * (10 per 15 minutes); once at the limit the password is not even checked.
 * Unknown emails, wrong passwords, and inactive users or organizations all
 * return the same `invalid`, and all cost one scrypt verification.
 */
export async function authenticate(email: string, password: string): Promise<AuthResult> {
  const normalised = normaliseEmail(email);
  const key = `login:${normalised}`;

  if (await isRateLimited(key, LOGIN_FAILURE_LIMIT, LOGIN_WINDOW_SECONDS)) {
    return { status: "locked" };
  }

  const [account] = await db
    .select({
      id: users.id,
      organizationId: users.organizationId,
      passwordHash: users.passwordHash,
      status: users.status,
      orgStatus: organizations.status,
      mfaEnabled: users.mfaEnabled,
    })
    .from(users)
    .innerJoin(organizations, eq(organizations.id, users.organizationId))
    .where(sql`lower(${users.email}) = ${normalised}`)
    .limit(1);

  const usable = account && account.status === "active" && account.orgStatus === "active";
  const hash = usable && account.passwordHash ? account.passwordHash : await getDummyHash();
  const passwordOk = await verifyPassword(password, hash);

  if (!usable || !passwordOk) {
    await hitRateLimit(key, LOGIN_FAILURE_LIMIT, LOGIN_WINDOW_SECONDS);
    // `account` is for the caller's audit only; it must never reach the client.
    return account
      ? { status: "invalid", account: { id: account.id, organizationId: account.organizationId } }
      : { status: "invalid" };
  }

  await clearRateLimit(key);
  return {
    status: "ok",
    user: {
      id: account.id,
      organizationId: account.organizationId,
      mfaEnabled: account.mfaEnabled,
    },
  };
}
