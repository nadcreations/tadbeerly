import { beforeEach, describe, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { rateLimits } from "@/db/schema";
import { clearRateLimit, hitRateLimit, isRateLimited } from "@/lib/rateLimit";
import { resetDb } from "../setup/factories";

beforeEach(resetDb);

async function ageWindow(key: string, seconds: number) {
  const [row] = await db.select().from(rateLimits).where(eq(rateLimits.key, key));
  await db
    .update(rateLimits)
    .set({ windowStart: new Date(row.windowStart.getTime() - seconds * 1000) })
    .where(eq(rateLimits.key, key));
}

describe("hitRateLimit", () => {
  test("allows up to the limit, then refuses", async () => {
    expect(await hitRateLimit("k", 2, 60)).toEqual({ allowed: true, remaining: 1 });
    expect(await hitRateLimit("k", 2, 60)).toEqual({ allowed: true, remaining: 0 });
    expect(await hitRateLimit("k", 2, 60)).toEqual({ allowed: false, remaining: 0 });
  });

  test("window resets once it has passed", async () => {
    expect((await hitRateLimit("k", 1, 1)).allowed).toBe(true);
    expect((await hitRateLimit("k", 1, 1)).allowed).toBe(false);
    await ageWindow("k", 5);
    expect((await hitRateLimit("k", 1, 1)).allowed).toBe(true);
  });

  test("concurrent hits are counted atomically", async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () => hitRateLimit("race", 5, 60)),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(5);
    const [row] = await db.select().from(rateLimits).where(eq(rateLimits.key, "race"));
    expect(row.count).toBe(8);
  });

  test("keys are independent", async () => {
    await hitRateLimit("a", 1, 60);
    expect((await hitRateLimit("b", 1, 60)).allowed).toBe(true);
  });
});

describe("isRateLimited and clearRateLimit", () => {
  test("peeking does not count, and respects the window", async () => {
    expect(await isRateLimited("k", 2, 60)).toBe(false);
    await hitRateLimit("k", 2, 60);
    await hitRateLimit("k", 2, 60);
    expect(await isRateLimited("k", 2, 60)).toBe(true);
    const [row] = await db.select().from(rateLimits).where(eq(rateLimits.key, "k"));
    expect(row.count).toBe(2);
    await ageWindow("k", 120);
    expect(await isRateLimited("k", 2, 60)).toBe(false);
  });

  test("clear removes the key", async () => {
    await hitRateLimit("k", 1, 60);
    await clearRateLimit("k");
    expect(await isRateLimited("k", 1, 60)).toBe(false);
    expect((await hitRateLimit("k", 1, 60)).allowed).toBe(true);
  });
});
