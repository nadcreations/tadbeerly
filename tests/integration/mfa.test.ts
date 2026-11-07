import { beforeEach, describe, expect, test, vi } from "vitest";
import { clearCookies, getCookie, setCookie } from "../setup/nextMocks";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  auditEvents,
  mfaChallenges,
  mfaRecoveryCodes,
  organizations,
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
import { SESSION_COOKIE } from "@/lib/session";
import { count, makeAgent, makeOrg, resetDb, userById } from "../setup/factories";

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock("next/server", () => ({
  after: (task: () => unknown) => void Promise.resolve().then(task),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

beforeEach(async () => {
  await resetDb();
  clearCookies();
});

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
    await db.insert(mfaRecoveryCodes).values({ userId: user.id, codeHash: hashRecoveryCode(code) });
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

    const disabled = await disableMfa({}, (() => {
      const f = new FormData();
      f.set("password", "Password123!");
      return f;
    })());
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
    const f = new FormData();
    f.set("password", "Password123!");
    const state = await disableMfa({}, f);
    expect(state.error).toContain("Administrators");
    expect((await userById(user.id)).mfaEnabled).toBe(true);
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
