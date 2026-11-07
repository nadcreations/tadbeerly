import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { loadEnv, requireEnv } from "@/lib/env";

loadEnv();

const client = postgres(requireEnv("DATABASE_URL"), { max: 1 });

await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
console.log("Migrations applied.");
await client.end();
