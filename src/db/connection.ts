/**
 * Driver options that depend on where the database lives.
 *
 * - **Prepared statements** are off behind a transaction pooler. Supabase's
 *   pooler (Supavisor) on port 6543, like PgBouncer in transaction mode, hands
 *   each transaction to whichever server connection is free, so a statement
 *   prepared on one may be missing on the next. Port 6543 is that pooler's
 *   convention; `DB_PREPARE=false` forces it off for any other setup.
 * - **SSL** is required for any database that is not on this machine, unless
 *   the URL states its own `sslmode`, which the driver then honours.
 */

type Env = Record<string, string | undefined>;

export type ConnectionOptions = {
  prepare: boolean;
  ssl: false | "require" | undefined;
};

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1", ""]);

export function connectionOptions(url: string, env: Env = process.env): ConnectionOptions {
  const parsed = new URL(url);
  const prepare = env.DB_PREPARE?.trim().toLowerCase() !== "false" && parsed.port !== "6543";

  const statesSsl = parsed.searchParams.has("sslmode") || parsed.searchParams.has("ssl");
  const ssl = statesSsl ? undefined : LOCAL_HOSTS.has(parsed.hostname) ? false : "require";

  return { prepare, ssl };
}
