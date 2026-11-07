import { expect, test } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/password";

test("scrypt round-trip", async () => {
  const h = await hashPassword("Password123!");
  expect(await verifyPassword("Password123!", h)).toBe(true);
  expect(await verifyPassword("wrong", h)).toBe(false);
});
