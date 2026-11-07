/**
 * Where this code is running, decided in one place.
 *
 * `NETLIFY` is set while a site is **built** and not while its functions
 * **run**, so a check on that variable alone answers "long-running server"
 * inside a function. Storage learned this first: it chose local disk inside a
 * function, where the filesystem is read-only. The database pool had the same
 * bug the other way round: ten connections per function instance instead of
 * one. Both now ask here.
 *
 * Each check takes the environment as a parameter (defaulting to the real one),
 * so tests can pass a plain object instead of mutating `process.env`.
 */

type Env = Record<string, string | undefined>;

/**
 * Whether a Netlify blob store can be reached from here.
 *
 * The Blobs SDK resolves its credentials from exactly these two places: a
 * global the platform injects into a running function, and a variable it sets
 * for builds and the CLI. Agreeing with the SDK means storage never selects a
 * backend the SDK would then refuse to use.
 */
export function netlifyBlobsReachable(env: Env = process.env): boolean {
  return Boolean(
    (globalThis as { netlifyBlobsContext?: unknown }).netlifyBlobsContext ||
      env.NETLIFY_BLOBS_CONTEXT,
  );
}

/**
 * Whether this is a short-lived serverless function rather than a long-running
 * server: Netlify at build time (`NETLIFY`), Netlify at function runtime (the
 * blobs context), or AWS Lambda, which Netlify functions run on.
 */
export function isServerlessRuntime(env: Env = process.env): boolean {
  return Boolean(env.NETLIFY || env.AWS_LAMBDA_FUNCTION_NAME || netlifyBlobsReachable(env));
}
