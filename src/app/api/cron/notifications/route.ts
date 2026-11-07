import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { dispatchPending } from "@/lib/email/outbox";

export const dynamic = "force-dynamic";

function authorized(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  // Fail closed: without a configured secret this endpoint is simply off,
  // rather than open to anyone who finds the URL.
  if (!expected) return false;

  const provided = request.headers.get("x-cron-secret") ?? "";
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Drains the notification outbox.
 *
 * Actions try to send immediately after they commit, so this exists to catch
 * what that missed (a mail server that was down, a process that restarted
 * mid-send). The SLA sweep joins it in M3. Point a scheduler at it every few
 * minutes:
 *
 *   curl -X POST -H "x-cron-secret: $CRON_SECRET" https://host/api/cron/notifications
 */
export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Drain in batches so one call clears a backlog, with a cap so a large
  // queue cannot hold the request open indefinitely.
  let sent = 0;
  let failed = 0;
  let deferred = 0;

  for (let batch = 0; batch < 10; batch += 1) {
    const result = await dispatchPending(50);
    sent += result.sent;
    failed += result.failed;
    deferred += result.deferred;
    if (result.sent + result.failed + result.deferred === 0) break;
  }

  return NextResponse.json({ dispatched: { sent, failed, deferred } });
}
