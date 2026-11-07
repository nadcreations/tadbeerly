import { afterEach, describe, expect, test } from "vitest";
import { resolvePoolMax } from "@/db";
import { isServerlessRuntime, netlifyBlobsReachable } from "@/lib/runtime";

const runtimeGlobal = globalThis as { netlifyBlobsContext?: unknown };

afterEach(() => {
  delete runtimeGlobal.netlifyBlobsContext;
});

describe("isServerlessRuntime", () => {
  test("is false on a long-running server", () => {
    expect(isServerlessRuntime({})).toBe(false);
  });

  test.each(["NETLIFY", "NETLIFY_BLOBS_CONTEXT", "AWS_LAMBDA_FUNCTION_NAME"])(
    "is true when %s is set",
    (key) => {
      expect(isServerlessRuntime({ [key]: "x" })).toBe(true);
    },
  );

  test("is true inside a Netlify function, where only the blobs context global is set", () => {
    runtimeGlobal.netlifyBlobsContext = "context";
    expect(isServerlessRuntime({})).toBe(true);
  });

  test("an empty variable does not count", () => {
    expect(isServerlessRuntime({ NETLIFY: "", AWS_LAMBDA_FUNCTION_NAME: "" })).toBe(false);
  });
});

describe("netlifyBlobsReachable", () => {
  test("follows the Blobs SDK's own two sources, not the platform", () => {
    expect(netlifyBlobsReachable({})).toBe(false);
    expect(netlifyBlobsReachable({ NETLIFY: "true" })).toBe(false);
    expect(netlifyBlobsReachable({ AWS_LAMBDA_FUNCTION_NAME: "f" })).toBe(false);
    expect(netlifyBlobsReachable({ NETLIFY_BLOBS_CONTEXT: "x" })).toBe(true);
    runtimeGlobal.netlifyBlobsContext = "context";
    expect(netlifyBlobsReachable({})).toBe(true);
  });
});

describe("resolvePoolMax", () => {
  test("ten connections on a long-running server", () => {
    expect(resolvePoolMax({})).toBe(10);
  });

  test("one connection in a serverless function, even where NETLIFY is unset at runtime", () => {
    expect(resolvePoolMax({ NETLIFY: "true" })).toBe(1);
    expect(resolvePoolMax({ NETLIFY_BLOBS_CONTEXT: "x" })).toBe(1);
    expect(resolvePoolMax({ AWS_LAMBDA_FUNCTION_NAME: "f" })).toBe(1);
    runtimeGlobal.netlifyBlobsContext = "context";
    expect(resolvePoolMax({})).toBe(1);
  });

  test("DB_POOL_MAX overrides the detection either way", () => {
    expect(resolvePoolMax({ DB_POOL_MAX: "3" })).toBe(3);
    expect(resolvePoolMax({ DB_POOL_MAX: "4", NETLIFY: "true" })).toBe(4);
    expect(resolvePoolMax({ DB_POOL_MAX: " 2 " })).toBe(2);
    expect(resolvePoolMax({ DB_POOL_MAX: "1" })).toBe(1);
  });

  test("an empty DB_POOL_MAX counts as unset", () => {
    expect(resolvePoolMax({ DB_POOL_MAX: "" })).toBe(10);
    expect(resolvePoolMax({ DB_POOL_MAX: "  " })).toBe(10);
  });

  test.each(["0", "-1", "1.5", "abc", "3x", "1e2"])(
    "DB_POOL_MAX=%s is refused, naming the variable",
    (value) => {
      expect(() => resolvePoolMax({ DB_POOL_MAX: value })).toThrow(/DB_POOL_MAX/);
    },
  );
});
