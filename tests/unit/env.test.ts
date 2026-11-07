import { expect, test } from "vitest";
import { requireEnv } from "@/lib/env";

test("requireEnv names the missing variable", () => {
  delete process.env.TB_NOT_SET;
  expect(() => requireEnv("TB_NOT_SET")).toThrow(/TB_NOT_SET/);
});
