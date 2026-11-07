import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { clearCookies, getCookie, setCookie } from "../setup/nextMocks";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  auditEvents,
  mfaChallenges,
  mfaRecoveryCodes,
  organizations,
  rateLimits,
  sessions,
  users,
} from "@/db/schema";
import {
  MAX_ATTEMPTS,
  MFA_COOKIE,
  createChallenge,
  getChallenge,
  mfaGateRedirect,
  recordFailedAttempt,
  verifyMfaCode,
} from "@/lib/mfa";
import {
  codeForStep,
  currentStep,
  encryptSecret,
  generateRecoveryCodes,
  generateSecret,
  hashRecoveryCode,
} from "@/lib/totp";
import { login } from "@/lib/actions/auth";
import {
  beginMfaEnrolment,
  confirmMfaEnrolment,
  disableMfa,
  regenerateRecoveryCodes,
  verifyMfaChallenge,
} from "@/lib/actions/mfa";
import { decryptSecret } from "@/lib/totp";
import { revalidatePath } from "next/cache";
import { SESSION_COOKIE, createSession } from "@/lib/session";
import { clearRateLimit, isRateLimited } from "@/lib/rateLimit";
import { count, makeAgent, makeOrg, resetDb, userById } from "../setup/factories";

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock("next/server", () => ({
  after: (task: () => unknown) => void Promise.resolve().then(task),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// Pin the clock ten seconds into a TOTP step so a test can never straddle a
// boundary. Only Date is faked; the database keeps real time.
beforeEach(async () => {
  await resetDb();
  clearCookies();
  vi.mocked(revalidatePath).mockClear();
  const now = Date.now();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Math.floor(now / 30000) * 30000 + 10000);
});
afterEach(() => vi.useRealTimers());

async function enrolledAgent(roleKey = "agent") {
  const org = await makeOrg();
  const secret = generateSecret();
  const user = await makeAgent(org.id, roleKey, {
    mfaEnabled: true,
    mfaSecret: encryptSecret(secret),
    mfaEnrolledAt: new Date(),
  });
  return { org, user, secret };
}

const codeForm = (code: string) => {
  const f = new FormData();
  f.set("code", code);
  return f;
};
const loginForm = (email: string) => {
  const f = new FormData();
  f.set("email", email);
  f.set("password", "Password123!");
  return f;
};
const redirectOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return (e as Error).message;
  }
  return null;
};
const disableForm = (password: string, code: string) => {
  const f = new FormData();
  f.set("password", password);
  f.set("code", code);
  return f;
};
const codeForNow = (secret: string) => codeForStep(secret, currentStep());
const wrongCode = (secret: string) => (codeForNow(secret) === "000000" ? "111111" : "000000");

describe("verifyMfaCode", () => {
  test("a code cannot be used twice", async () => {
    const { user, secret } = await enrolledAgent();
    const code = codeForNow(secret);
    expect(await verifyMfaCode(user.id, code)).toBe("ok");
    expect((await userById(user.id)).mfaLastUsedStep).toBe(currentStep());
    expect(await verifyMfaCode(user.id, code)).toBe("replayed");
  });

  test("a wrong code is invalid", async () => {
    const { user, secret } = await enrolledAgent();
    expect(await verifyMfaCode(user.id, wrongCode(secret))).toBe("invalid");
  });

  test("a user without MFA is invalid", async () => {
    const org = await makeOrg();
    const user = await makeAgent(org.id);
    expect(await verifyMfaCode(user.id, "123456")).toBe("invalid");
  });
});

describe("challenges", () => {
  test("five wrong codes burn the challenge", async () => {
    const { user } = await enrolledAgent();
    await createChallenge(user.id);
    const c = (await getChallenge())!;
    expect(c).not.toBeNull();
    for (let i = 0; i < MAX_ATTEMPTS; i++) await recordFailedAttempt(c.challengeId);
    expect(await getChallenge()).toBeNull();
  });

  test("a disabled account's challenge stops resolving", async () => {
    const { user } = await enrolledAgent();
    await createChallenge(user.id);
    await db.update(users).set({ status: "disabled" }).where(eq(users.id, user.id));
    expect(await getChallenge()).toBeNull();
  });

  test("a suspended organization's challenge stops resolving", async () => {
    const { org, user } = await enrolledAgent();
    await createChallenge(user.id);
    await db.update(organizations).set({ status: "suspended" }).where(eq(organizations.id, org.id));
    expect(await getChallenge()).toBeNull();
  });
});

describe("login with MFA", () => {
  test("password step opens a challenge and issues no session", async () => {
    const { user } = await enrolledAgent();
    expect(await redirectOf(login({}, loginForm(user.email)))).toBe("REDIRECT:/login/verify");
    expect(getCookie(MFA_COOKIE)).toBeTruthy();
    expect(getCookie(SESSION_COOKIE)).toBeUndefined();
    expect(await count(sessions)).toBe(0);
    expect(await count(mfaChallenges)).toBe(1);
  });

  test("a valid code signs in, audits with mfa metadata and clears the challenge", async () => {
    const { user, secret } = await enrolledAgent();
    await redirectOf(login({}, loginForm(user.email)));
    const r = await redirectOf(verifyMfaChallenge({}, codeForm(codeForNow(secret))));
    expect(r).toBe("REDIRECT:/tickets");
    expect(getCookie(SESSION_COOKIE)).toBeTruthy();
    expect(await count(mfaChallenges)).toBe(0);
    expect((await userById(user.id)).lastLoginAt).not.toBeNull();
    const [ev] = await db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.action, "auth.login"), eq(auditEvents.actorUserId, user.id)));
    expect(ev.metadata).toMatchObject({ mfa: true });
    expect(ev.organizationId).toBe(user.organizationId);
  });

  test("a wrong code is refused with attempts left and no session", async () => {
    const { user, secret } = await enrolledAgent();
    await redirectOf(login({}, loginForm(user.email)));
    const state = await verifyMfaChallenge({}, codeForm(wrongCode(secret)));
    expect(state.fieldErrors?.code?.[0]).toContain("4 attempts left");
    expect(getCookie(SESSION_COOKIE)).toBeUndefined();
  });

  test("a recovery code works once", async () => {
    const { user } = await enrolledAgent();
    const [code] = generateRecoveryCodes(1);
    await db.insert(mfaRecoveryCodes).values({ userId: user.id, codeHash: hashRecoveryCode(user.id, code) });
    await redirectOf(login({}, loginForm(user.email)));
    expect(await redirectOf(verifyMfaChallenge({}, codeForm(code)))).toBe("REDIRECT:/tickets");
    const [row] = await db
      .select()
      .from(mfaRecoveryCodes)
      .where(eq(mfaRecoveryCodes.userId, user.id));
    expect(row.usedAt).not.toBeNull();

    clearCookies();
    await redirectOf(login({}, loginForm(user.email)));
    const state = await verifyMfaChallenge({}, codeForm(code));
    expect(state.fieldErrors?.code).toBeDefined();
    expect(getCookie(SESSION_COOKIE)).toBeUndefined();
  });

  test("an account disabled between the steps cannot finish signing in", async () => {
    const { user, secret } = await enrolledAgent();
    await redirectOf(login({}, loginForm(user.email)));
    await db.update(users).set({ status: "disabled" }).where(eq(users.id, user.id));
    const state = await verifyMfaChallenge({}, codeForm(codeForNow(secret)));
    expect(state.error).toContain("expired");
    expect(await count(sessions)).toBe(0);
  });

  test("an unknown challenge cookie is refused", async () => {
    setCookie(MFA_COOKIE, "bogus");
    const state = await verifyMfaChallenge({}, codeForm("123456"));
    expect(state.error).toContain("expired");
  });

  test("a user without MFA signs straight in", async () => {
    const org = await makeOrg();
    const user = await makeAgent(org.id);
    expect(await redirectOf(login({}, loginForm(user.email)))).toBe("REDIRECT:/tickets");
    expect(getCookie(SESSION_COOKIE)).toBeTruthy();
    expect(await count(mfaChallenges)).toBe(0);
  });
});

describe("enrolment actions", () => {
  async function signedIn(roleKey = "agent") {
    const org = await makeOrg();
    const user = await makeAgent(org.id, roleKey);
    await redirectOf(login({}, loginForm(user.email)));
    return user;
  }
  const actions = (userId: string) =>
    db.select().from(auditEvents).where(eq(auditEvents.actorUserId, userId));

  test("enrol, regenerate and disable are each audited under the organization", async () => {
    const user = await signedIn();
    await beginMfaEnrolment({}, new FormData());
    const secret = decryptSecret((await userById(user.id)).mfaSecret!)!;
    const confirmed = await confirmMfaEnrolment({}, codeForm(codeForNow(secret)));
    expect(confirmed.success).toMatch(/^enrolled:/);
    expect(confirmed.success!.split(",")).toHaveLength(10);
    expect(await count(mfaRecoveryCodes, eq(mfaRecoveryCodes.userId, user.id))).toBe(10);

    // The same step is already spent, so regeneration needs the next one.
    const replay = await regenerateRecoveryCodes({}, codeForm(codeForNow(secret)));
    expect(replay.fieldErrors?.code?.[0]).toContain("already been used");
    await db
      .update(users)
      .set({ mfaLastUsedStep: currentStep() - 2 })
      .where(eq(users.id, user.id));
    const regenerated = await regenerateRecoveryCodes({}, codeForm(codeForNow(secret)));
    expect(regenerated.success).toMatch(/^enrolled:/);

    await db
      .update(users)
      .set({ mfaLastUsedStep: currentStep() - 2 })
      .where(eq(users.id, user.id));
    const disabled = await disableMfa({}, disableForm("Password123!", codeForNow(secret)));
    expect(disabled.success).toBeDefined();
    expect((await userById(user.id)).mfaEnabled).toBe(false);
    expect((await userById(user.id)).mfaSecret).toBeNull();

    const events = (await actions(user.id)).map((e) => e.action);
    expect(events).toEqual(
      expect.arrayContaining(["auth.mfa_enrolled", "auth.recovery_codes_regenerated", "auth.mfa_disabled"]),
    );
    for (const e of await actions(user.id)) expect(e.organizationId).toBe(user.organizationId);
  });

  test("an Administrator cannot switch MFA off", async () => {
    const user = await signedIn("administrator");
    await db.update(users).set({ mfaEnabled: true }).where(eq(users.id, user.id));
    const state = await disableMfa({}, disableForm("Password123!", "123456"));
    expect(state.error).toContain("Administrators");
    expect((await userById(user.id)).mfaEnabled).toBe(true);
  });
});

describe("second-factor brute force", () => {
  const hits = async (userId: string) =>
    (await db.select().from(rateLimits).where(eq(rateLimits.key, `mfa:${userId}`)))[0]?.count ?? 0;

  test("the per-user limit holds across fresh challenges", async () => {
    const { user, secret } = await enrolledAgent();
    // Three challenges: 4 + 4 + 2 wrong codes, never reaching 5 on any one.
    for (const n of [4, 4, 2]) {
      await redirectOf(login({}, loginForm(user.email)));
      for (let i = 0; i < n; i++) await verifyMfaChallenge({}, codeForm(wrongCode(secret)));
    }
    expect(await hits(user.id)).toBe(10);
    // A correct password does not reset it, and a correct code is not evaluated.
    await redirectOf(login({}, loginForm(user.email)));
    const state = await verifyMfaChallenge({}, codeForm(codeForNow(secret)));
    expect(state.error).toContain("Try again in 15 minutes");
    expect(getCookie(SESSION_COOKIE)).toBeUndefined();
    expect(await count(sessions)).toBe(0);
  });

  test("parallel attempts on one challenge never exceed MAX_ATTEMPTS evaluations", async () => {
    const { user, secret } = await enrolledAgent();
    await redirectOf(login({}, loginForm(user.email)));
    await Promise.all(
      Array.from({ length: 12 }, () => verifyMfaChallenge({}, codeForm(wrongCode(secret)))),
    );
    expect(await hits(user.id)).toBe(MAX_ATTEMPTS);
  });

  test("reaching MAX_ATTEMPTS clears the challenge and its cookie", async () => {
    const { user, secret } = await enrolledAgent();
    await redirectOf(login({}, loginForm(user.email)));
    let state = {} as Awaited<ReturnType<typeof verifyMfaChallenge>>;
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      state = await verifyMfaChallenge({}, codeForm(wrongCode(secret)));
    }
    expect(state.error).toContain("Sign in again");
    expect(await count(mfaChallenges)).toBe(0);
    expect(getCookie(MFA_COOKIE)).toBeUndefined();
  });

  test("a successful second factor clears the per-user limiter", async () => {
    const { user, secret } = await enrolledAgent();
    await redirectOf(login({}, loginForm(user.email)));
    await verifyMfaChallenge({}, codeForm(wrongCode(secret)));
    expect(await hits(user.id)).toBe(1);
    await redirectOf(verifyMfaChallenge({}, codeForm(codeForNow(secret))));
    expect(await isRateLimited(`mfa:${user.id}`, 1, 900)).toBe(false);
    expect(await hits(user.id)).toBe(0);
  });

  test("a TOTP code replayed at the verify step is refused", async () => {
    const { user, secret } = await enrolledAgent();
    const code = codeForNow(secret);
    await redirectOf(login({}, loginForm(user.email)));
    expect(await redirectOf(verifyMfaChallenge({}, codeForm(code)))).toBe("REDIRECT:/tickets");
    clearCookies();
    await redirectOf(login({}, loginForm(user.email)));
    const state = await verifyMfaChallenge({}, codeForm(code));
    expect(state.fieldErrors?.code).toBeDefined();
    expect(getCookie(SESSION_COOKIE)).toBeUndefined();
  });
});

describe("disableMfa", () => {
  async function enrolledSignedIn(roleKey = "agent") {
    const e = await enrolledAgent(roleKey);
    await createSession(e.user.id);
    return e;
  }

  test("a wrong code is refused", async () => {
    const { user, secret } = await enrolledSignedIn();
    const state = await disableMfa({}, disableForm("Password123!", wrongCode(secret)));
    expect(state.fieldErrors?.code).toBeDefined();
    expect((await userById(user.id)).mfaEnabled).toBe(true);
  });

  test("a wrong password is refused", async () => {
    const { user, secret } = await enrolledSignedIn();
    const state = await disableMfa({}, disableForm("nope-nope", codeForNow(secret)));
    expect(state.fieldErrors?.password).toBeDefined();
    expect((await userById(user.id)).mfaEnabled).toBe(true);
  });

  test("the correct password plus a recovery code succeeds", async () => {
    const { user } = await enrolledSignedIn();
    const [code] = generateRecoveryCodes(1);
    await db.insert(mfaRecoveryCodes).values({ userId: user.id, codeHash: hashRecoveryCode(user.id, code) });
    const state = await disableMfa({}, disableForm("Password123!", code));
    expect(state.success).toBeDefined();
    expect((await userById(user.id)).mfaEnabled).toBe(false);
  });

  test("failed disable attempts feed the per-user limiter", async () => {
    const { user, secret } = await enrolledSignedIn();
    for (let i = 0; i < 10; i++) await disableMfa({}, disableForm("nope-nope", wrongCode(secret)));
    const state = await disableMfa({}, disableForm("Password123!", codeForNow(secret)));
    expect(state.error).toContain("Try again in 15 minutes");
    expect((await userById(user.id)).mfaEnabled).toBe(true);
    await clearRateLimit(`mfa:${user.id}`);
  });

  test("is refused when MFA is not enabled", async () => {
    const org = await makeOrg();
    const user = await makeAgent(org.id);
    await createSession(user.id);
    const state = await disableMfa({}, disableForm("Password123!", "123456"));
    expect(state.error).toContain("not switched on");
    expect(await count(auditEvents, eq(auditEvents.action, "auth.mfa_disabled"))).toBe(0);
  });

  test("is refused under organization policy", async () => {
    const { org, user, secret } = await enrolledSignedIn();
    await db.update(organizations).set({ requireMfa: true }).where(eq(organizations.id, org.id));
    const state = await disableMfa({}, disableForm("Password123!", codeForNow(secret)));
    expect(state.error).toContain("requires two-step verification");
    expect((await userById(user.id)).mfaEnabled).toBe(true);
  });
});

describe("enrolment details", () => {
  async function pending() {
    const org = await makeOrg();
    const user = await makeAgent(org.id);
    await createSession(user.id);
    await beginMfaEnrolment({}, new FormData());
    const secret = decryptSecret((await userById(user.id)).mfaSecret!)!;
    return { user, secret };
  }

  test("beginning enrolment is audited", async () => {
    const { user } = await pending();
    expect(await count(auditEvents, eq(auditEvents.action, "auth.mfa_enrolment_started"))).toBe(1);
    expect((await userById(user.id)).mfaEnabled).toBe(false);
  });

  test("confirming does not revalidate, so the codes stay on screen", async () => {
    const { secret } = await pending();
    vi.mocked(revalidatePath).mockClear();
    const state = await confirmMfaEnrolment({}, codeForm(codeForNow(secret)));
    expect(state.success).toMatch(/^enrolled:/);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  test("a double submit enrols once and issues one set of codes", async () => {
    const { user, secret } = await pending();
    const code = codeForNow(secret);
    const results = await Promise.all([
      confirmMfaEnrolment({}, codeForm(code)),
      confirmMfaEnrolment({}, codeForm(code)),
    ]);
    expect(results.filter((r) => r.success?.startsWith("enrolled:"))).toHaveLength(1);
    expect(await count(mfaRecoveryCodes, eq(mfaRecoveryCodes.userId, user.id))).toBe(10);
    expect(await count(auditEvents, eq(auditEvents.action, "auth.mfa_enrolled"))).toBe(1);
  });
});

describe("mfaGateRedirect", () => {
  const agent = { id: "r", key: "agent", name: "Agent", isLocked: false };
  const admin = { id: "a", key: "administrator", name: "Administrator", isLocked: true };
  test.each([
    [{ organizationRequiresMfa: true, mfaEnabled: false, role: agent }, "/tickets", "/security"],
    [{ organizationRequiresMfa: true, mfaEnabled: false, role: agent }, "/security", null],
    [{ organizationRequiresMfa: true, mfaEnabled: false, role: agent }, "/security/x", null],
    [{ organizationRequiresMfa: true, mfaEnabled: true, role: agent }, "/tickets", null],
    [{ organizationRequiresMfa: false, mfaEnabled: false, role: agent }, "/admin", null],
    [{ organizationRequiresMfa: false, mfaEnabled: false, role: admin }, "/admin", "/security"],
    [{ organizationRequiresMfa: false, mfaEnabled: true, role: admin }, "/admin", null],
    [{ organizationRequiresMfa: false, mfaEnabled: false, role: null }, "/admin", null],
  ])("gate %o at %s -> %s", (u, path, expected) => {
    expect(mfaGateRedirect(u, path)).toBe(expected);
  });
});
