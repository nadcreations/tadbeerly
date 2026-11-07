import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { databaseUrl, loadEnv } from "@/lib/env";
import { connectionOptions } from "./connection";

loadEnv();

// The same resolution as the app: DATABASE_URL, else NETLIFY_DATABASE_URL.
const url = databaseUrl();
const { prepare, ssl } = connectionOptions(url);
const client = postgres(url, {
  max: 1,
  prepare,
  ...(ssl === undefined ? {} : { ssl }),
  onnotice: () => {},
});

await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
console.log("Migrations applied.");
await client.end();
