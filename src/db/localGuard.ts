const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

/**
 * Throws unless the database URL names exactly one host and it is localhost or
 * 127.0.0.1. Guards the destructive helpers (the seed and the table truncate).
 *
 * Deliberately strict: a socket-style URL (no host), a multi-host URL, a
 * `host=` query override, IPv6 (`[::1]`) and look-alike names such as
 * `localhost.evil.com` are all refused. There is no override.
 */
export function assertLocalDatabase(
  url: string | undefined = process.env.DATABASE_URL ?? process.env.NETLIFY_DATABASE_URL,
): void {
  let host: string | null = null;
  let overridden = false;
  try {
    if (url) {
      const parsed = new URL(url);
      host = parsed.hostname;
      overridden = parsed.searchParams.has("host") || parsed.searchParams.has("hostaddr");
    }
  } catch {
    host = null;
  }
  if (!host || overridden || !LOCAL_HOSTS.has(host)) {
    throw new Error(
      `Refusing to run: this empties every table, so it only runs against a database on localhost or 127.0.0.1 (DATABASE_URL host is ${host || "missing or unreadable"}).`,
    );
  }
}
