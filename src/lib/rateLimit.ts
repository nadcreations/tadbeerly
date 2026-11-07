import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "@/db";
import { rateLimits } from "@/db/schema";

/**
 * Counts one hit against `key` in a fixed window. A single upsert, so
 * concurrent callers cannot read the same count and both slip under the limit.
 * Timing comes from the database clock, so app servers need no clock agreement.
 */
export async function hitRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<{ allowed: boolean; remaining: number }> {
  const expired = sql`${rateLimits.windowStart} <= now() - make_interval(secs => ${windowSeconds})`;
  const [row] = await db
    .insert(rateLimits)
    .values({ key, windowStart: sql`now()`, count: 1 })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`case when ${expired} then 1 else ${rateLimits.count} + 1 end`,
        windowStart: sql`case when ${expired} then now() else ${rateLimits.windowStart} end`,
      },
    })
    .returning({ count: rateLimits.count });

  return {
    allowed: row.count <= limit,
    remaining: Math.max(0, limit - row.count),
  };
}

/** Whether `key` already has `limit` or more hits inside the window. Counts nothing. */
export async function isRateLimited(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  const [row] = await db
    .select({ count: rateLimits.count })
    .from(rateLimits)
    .where(
      and(
        eq(rateLimits.key, key),
        gt(rateLimits.windowStart, sql`now() - make_interval(secs => ${windowSeconds})`),
      ),
    );
  return (row?.count ?? 0) >= limit;
}

export async function clearRateLimit(key: string): Promise<void> {
  await db.delete(rateLimits).where(eq(rateLimits.key, key));
}
