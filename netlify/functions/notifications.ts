/**
 * The scheduler for the notification outbox.
 *
 * Every action that raises a notification tries to send it immediately after
 * the transaction commits. On a long-running server that is almost always
 * enough. On a serverless platform it is not: the function can be frozen the
 * moment the response is written, so a send that takes a second too long is
 * abandoned half-done — which is exactly what happened here, a row left
 * `pending` with one attempt and `Timeout` against it, and nothing to notice.
 *
 * `POST /api/cron/notifications` exists to catch that, and to run the
 * scheduled sweeps (SLA checks arrive in a later milestone), which have no
 * triggering action at all. It was documented as something
 * to point a scheduler at, and nothing was pointed at it. This is that
 * scheduler, living in the repository so it deploys with the code rather than
 * being a setting somebody has to remember.
 *
 * It calls the endpoint over HTTP rather than importing the dispatcher: this
 * runs as a Netlify function, the dispatcher runs inside Next, and they are
 * separate bundles with separate builds. One public request with a shared
 * secret is a smaller thing to keep working than a shared module graph.
 *
 * Netlify runs scheduled functions on production deploys only, so previews and
 * branch deploys will not send anybody's mail.
 */

export default async function handler(): Promise<Response> {
  const secret = process.env.CRON_SECRET;

  /*
   * The endpoint fails closed without a secret, so calling it would only ever
   * collect a 401. Say why, once per run, rather than filling the log with
   * unauthorised requests that look like an attack.
   */
  if (!secret) {
    console.warn(
      "[notifications] CRON_SECRET is not set, so the outbox endpoint is " +
        "disabled and nothing can be dispatched. Set it in the site's " +
        "environment variables.",
    );
    return new Response("CRON_SECRET not set", { status: 200 });
  }

  // URL is the site's primary address on a production deploy. The fallbacks
  // matter only if this is ever run somewhere else by hand.
  const base =
    process.env.URL ?? process.env.DEPLOY_PRIME_URL ?? process.env.DEPLOY_URL;

  if (!base) {
    console.error("[notifications] No site URL in the environment.");
    return new Response("No site URL", { status: 500 });
  }

  const endpoint = `${base.replace(/\/$/, "")}/api/cron/notifications`;

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "x-cron-secret": secret },
      /*
       * Generous, and deliberately shorter than the platform's own ceiling.
       * The endpoint drains up to ten batches of fifty, so a large backlog is
       * slow by design; being cut off by the platform mid-drain would leave
       * rows claimed with their attempt counter already incremented.
       */
      signal: AbortSignal.timeout(25_000),
    });

    const body = await response.text();

    if (!response.ok) {
      console.error(
        `[notifications] ${endpoint} answered ${response.status}: ${body.slice(0, 300)}`,
      );
      return new Response(body, { status: 502 });
    }

    // Logged on success too: "sent 0, failed 3" is the shape of a problem, and
    // a silent success tells nobody the difference.
    console.log(`[notifications] ${body.slice(0, 300)}`);
    return new Response(body, { status: 200 });
  } catch (error) {
    console.error(
      `[notifications] could not reach ${endpoint}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return new Response("Dispatch failed", { status: 502 });
  }
}

/*
 * Every five minutes: the longest a message should sit unsent after the
 * immediate attempt has failed. Netlify's minimum is one minute; going that
 * often would mostly be a hundred no-op queries an hour against the database.
 */
export const config = { schedule: "*/5 * * * *" };
