import { describe, expect, test } from "vitest";
import {
  codeForStep,
  currentStep,
  decryptSecret,
  encryptSecret,
  generateSecret,
  hashRecoveryCode,
  otpauthUrl,
  verifyTotp,
} from "@/lib/totp";

describe("totp", () => {
  test("RFC 6238 SHA-1 vector", () => {
    // ASCII "12345678901234567890" in base32; T=59s -> step 1 -> 6-digit 287082
    expect(codeForStep("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 1)).toBe("287082");
  });

  test("accepts the current step and refuses a replay", () => {
    const secret = generateSecret();
    const step = currentStep();
    const code = codeForStep(secret, step);
    expect(verifyTotp(secret, code)).toEqual({ valid: true, step });
    expect(verifyTotp(secret, code, { lastUsedStep: step })).toEqual({
      valid: false,
      reason: "replayed",
    });
  });

  test("secrets round-trip through encryption and tampering is rejected", () => {
    const secret = generateSecret();
    const stored = encryptSecret(secret);
    expect(stored).not.toContain(secret);
    expect(decryptSecret(stored)).toBe(secret);
    const parts = stored.split(".");
    parts[3] = Buffer.from("tampered").toString("base64");
    expect(decryptSecret(parts.join("."))).toBeNull();
  });

  test("otpauth label uses the Tadbeerly issuer by default", () => {
    const url = otpauthUrl("ABC", "a@b.example");
    expect(url).toContain(encodeURIComponent("Tadbeerly:a@b.example"));
    expect(url).toContain("issuer=Tadbeerly");
  });

  test("recovery codes hash the same however they are typed", () => {
    expect(hashRecoveryCode("abcde-fghij")).toBe(hashRecoveryCode("ABCDEFGHIJ"));
  });
});
