import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { loadEnv, requireEnv } from "../../src/lib/env";

/** Brings the test database up to the current schema once per run. */
export default async function setup() {
  loadEnv();
  const url = requireEnv("TEST_DATABASE_URL");
  // Never migrate (or later truncate) anything but the test database.
  if (!url.includes("tadbeerly_test")) {
    throw new Error("TEST_DATABASE_URL must point at tadbeerly_test.");
  }
  const client = postgres(url, { max: 1 });
  try {
    await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
  } finally {
    await client.end();
  }
}
