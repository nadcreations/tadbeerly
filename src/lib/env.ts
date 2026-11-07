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

export function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(
      `Missing required environment variable ${key}. Copy .env.example to .env.local and fill it in.`,
    );
  }
  return value;
}
