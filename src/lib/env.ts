import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Next.js loads `.env.local` automatically, but standalone scripts (drizzle-kit,
 * tsx seed/migrate) do not. This loads it without adding a dotenv dependency.
 * Existing process.env values always win.
 */
export function loadEnv(file = ".env.local"): void {
  const path = resolve(process.cwd(), file);
  if (!existsSync(path)) return;

  for (const rawLine of readFileSync(path, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const eq = line.indexOf("=");
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    if (key in process.env) continue;

    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

export function requireEnv(
  key: string,
  env: Record<string, string | undefined> = process.env,
): string {
  const value = env[key];
  if (!value) {
    throw new Error(
      `Missing required environment variable ${key}. Copy .env.example to .env.local and fill it in.`,
    );
  }
  return value;
}

/**
 * The database connection string, for the app and for migrations alike.
 *
 * Netlify's Neon extension provisions a database and exposes it under its own
 * name. Reading that as a fallback means a deployment using the extension works
 * without anyone copying the URL into a second variable, but DATABASE_URL still
 * wins, so an explicit setting is never quietly overridden.
 */
export function databaseUrl(env: Record<string, string | undefined> = process.env): string {
  if (env.DATABASE_URL) return env.DATABASE_URL;
  if (env.NETLIFY_DATABASE_URL) return env.NETLIFY_DATABASE_URL;
  // Throws naming the variable and how to set it.
  return requireEnv("DATABASE_URL", env);
}
