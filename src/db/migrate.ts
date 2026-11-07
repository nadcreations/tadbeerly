import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { databaseUrl, loadEnv } from "@/lib/env";

loadEnv();

// The same resolution as the app: DATABASE_URL, else NETLIFY_DATABASE_URL.
const client = postgres(databaseUrl(), { max: 1 });

await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
console.log("Migrations applied.");
await client.end();
