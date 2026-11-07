import { expect, test } from "vitest";
import { databaseUrl, requireEnv } from "@/lib/env";

test("requireEnv names the missing variable", () => {
  delete process.env.TB_NOT_SET;
  expect(() => requireEnv("TB_NOT_SET")).toThrow(/TB_NOT_SET/);
});

test("databaseUrl prefers DATABASE_URL, falls back to NETLIFY_DATABASE_URL, else names DATABASE_URL", () => {
  expect(databaseUrl({ DATABASE_URL: "postgres://a", NETLIFY_DATABASE_URL: "postgres://b" })).toBe(
    "postgres://a",
  );
  expect(databaseUrl({ NETLIFY_DATABASE_URL: "postgres://b" })).toBe("postgres://b");
  expect(databaseUrl({ DATABASE_URL: "", NETLIFY_DATABASE_URL: "postgres://b" })).toBe(
    "postgres://b",
  );
  expect(() => databaseUrl({})).toThrow(/DATABASE_URL/);
});
