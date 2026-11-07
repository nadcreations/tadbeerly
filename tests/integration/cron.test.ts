import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { POST } from "@/app/api/cron/notifications/route";

const call = (secret?: string) =>
  POST(
    new Request("http://localhost/api/cron/notifications", {
      method: "POST",
      headers: secret === undefined ? {} : { "x-cron-secret": secret },
    }),
  );

let original: string | undefined;
beforeEach(() => {
  original = process.env.CRON_SECRET;
});
afterEach(() => {
  if (original === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = original;
});

describe("cron notifications route", () => {
  test("401 when CRON_SECRET is unset", async () => {
    delete process.env.CRON_SECRET;
    expect((await call("anything")).status).toBe(401);
    expect((await call()).status).toBe(401);
  });

  test("401 when the secret is missing or wrong", async () => {
    process.env.CRON_SECRET = "right-secret";
    expect((await call()).status).toBe(401);
    expect((await call("wrong-secret")).status).toBe(401);
    expect((await call("short")).status).toBe(401);
  });

  test("200 with a dispatched summary for the right secret", async () => {
    process.env.CRON_SECRET = "right-secret";
    const response = await call("right-secret");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      dispatched: { sent: 0, failed: 0, deferred: 0 },
    });
  });
});
