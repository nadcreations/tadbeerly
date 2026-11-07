import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { loadEnv } from "./env";

loadEnv();

/* ---------------------------------------------------------------------------
 * Base32 (RFC 4648) — the encoding authenticator apps expect
 * ------------------------------------------------------------------------ */

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index === -1) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/* ---------------------------------------------------------------------------
 * TOTP (RFC 6238)
 * ------------------------------------------------------------------------ */

export const TIME_STEP_SECONDS = 30;
const DIGITS = 6;

/** How many steps either side of now are accepted, for clock drift. */
export const DRIFT_STEPS = 1;

export function currentStep(at: Date = new Date()): number {
  return Math.floor(at.getTime() / 1000 / TIME_STEP_SECONDS);
}

/** A fresh 160-bit secret, base32 encoded as authenticator apps expect. */
export function generateSecret(): string {
  return base32Encode(randomBytes(20));
}

export function codeForStep(secret: string, step: number): string {
  const key = base32Decode(secret);
  const counter = Buffer.alloc(8);
  // 8-byte big-endian counter; writeBigUInt64BE keeps it exact past 2^32.
  counter.writeBigUInt64BE(BigInt(step));

  const digest = createHmac("sha1", key).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  return String(binary % 10 ** DIGITS).padStart(DIGITS, "0");
}

export type TotpResult =
  | { valid: true; step: number }
  | { valid: false; reason: "malformed" | "incorrect" | "replayed" };

/**
 * Verifies a code against a secret.
 *
 * `lastUsedStep` is what stops replay: a code stays valid for its whole 30
 * second window, so without this an attacker who shoulder-surfs or intercepts
 * one can use it again seconds later. Any step at or below the last accepted
 * one is refused.
 */
export function verifyTotp(
  secret: string,
  code: string,
  options: { lastUsedStep?: number | null; at?: Date } = {},
): TotpResult {
  const cleaned = code.replace(/\D/g, "");
  if (cleaned.length !== DIGITS) return { valid: false, reason: "malformed" };

  const now = currentStep(options.at);

  for (let drift = -DRIFT_STEPS; drift <= DRIFT_STEPS; drift += 1) {
    const step = now + drift;
    const expected = codeForStep(secret, step);
    const a = Buffer.from(expected);
    const b = Buffer.from(cleaned);
    if (a.length === b.length && timingSafeEqual(a, b)) {
      if (options.lastUsedStep != null && step <= options.lastUsedStep) {
        return { valid: false, reason: "replayed" };
      }
      return { valid: true, step };
    }
  }

  return { valid: false, reason: "incorrect" };
}

/** The URI encoded into the enrolment QR code. */
export function otpauthUrl(
  secret: string,
  accountEmail: string,
  issuer = "Tadbeerly",
): string {
  const label = encodeURIComponent(`${issuer}:${accountEmail}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(TIME_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/** Grouped into blocks of four so it can be typed in by hand. */
export function formatSecretForDisplay(secret: string): string {
  return secret.replace(/(.{4})/g, "$1 ").trim();
}

/* ---------------------------------------------------------------------------
 * Encryption at rest
 * ------------------------------------------------------------------------ */

const derivedKeys = new Map<string, Buffer>();

/**
 * Derives a purpose-specific key from the MFA key material. scrypt is slow on
 * purpose, so each (salt, material) result is memoised rather than recomputed
 * on every call. Fixed salts: keys must be identical on every boot, and the
 * material itself is the secret.
 */
function deriveKey(salt: string): Buffer {
  const material =
    process.env.MFA_ENCRYPTION_KEY || process.env.SESSION_SECRET || "";
  if (!material) {
    throw new Error(
      "MFA requires MFA_ENCRYPTION_KEY (or SESSION_SECRET) to be set.",
    );
  }
  const id = `${salt}\0${material}`;
  let key = derivedKeys.get(id);
  if (!key) {
    key = scryptSync(material, salt, 32);
    derivedKeys.set(id, key);
  }
  return key;
}

const encryptionKey = () => deriveKey("tadbeerly.mfa.v1");

/**
 * TOTP secrets are stored encrypted.
 *
 * A stolen database backup should not hand over working second factors. The
 * key lives in the environment, so an attacker needs both the data and the
 * deployment configuration.
 */
export function encryptSecret(secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(secret, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    "v1",
    iv.toString("base64"),
    tag.toString("base64"),
    encrypted.toString("base64"),
  ].join(".");
}

export function decryptSecret(stored: string): string | null {
  const parts = stored.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return null;

  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      encryptionKey(),
      Buffer.from(parts[1], "base64"),
    );
    decipher.setAuthTag(Buffer.from(parts[2], "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(parts[3], "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // Wrong key or tampered ciphertext — treat as unusable rather than throwing
    // into a login request.
    return null;
  }
}

/* ---------------------------------------------------------------------------
 * Recovery codes
 * ------------------------------------------------------------------------ */

export const RECOVERY_CODE_COUNT = 10;

/** Unambiguous alphabet — no O/0, I/1 — because these get written down. */
const RECOVERY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const bytes = randomBytes(10);
    let code = "";
    for (const byte of bytes) code += RECOVERY_ALPHABET[byte % 32];
    codes.push(`${code.slice(0, 5)}-${code.slice(5)}`);
  }
  return codes;
}

/**
 * Recovery codes are stored as HMAC-SHA256 under a key derived from the MFA key
 * material, over `userId:code`.
 *
 * They carry only about 50 bits of randomness, so a plain or unsalted hash of
 * one would be crackable offline from a database leak, and one guess would be
 * testable against every user's codes at once. The key means a leak of the
 * table alone is not enough, and binding the user id makes each user's hashes
 * independent. HMAC stays fast, so sign-in does one hash, not a KDF pass.
 */
export function hashRecoveryCode(userId: string, code: string): string {
  return createHmac("sha256", deriveKey("tadbeerly.recovery.v1"))
    .update(`${userId}:${normaliseRecoveryCode(code)}`)
    .digest("hex");
}

export function normaliseRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}
