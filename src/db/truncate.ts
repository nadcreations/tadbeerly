import { sql } from "drizzle-orm";
import { db } from "@/db";

/**
 * Every table in the public schema, read from the database rather than listed
 * by hand so a table added later is never left out of a reset. Drizzle's own
 * bookkeeping lives in the "drizzle" schema and is not touched.
 */
export async function allTableNames(): Promise<string[]> {
  const rows = await db.execute<{ table_name: string }>(sql`
    select table_name from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
  `);
  return rows.map((r) => r.table_name);
}

/** Empties every table. Shared by the test reset and the demo seed. */
export async function truncateAllTables(): Promise<void> {
  const names = await allTableNames();
  if (names.length === 0) return;
  const list = sql.join(
    names.map((n) => sql.identifier(n)),
    sql`, `,
  );
  await db.execute(sql`truncate table ${list} restart identity cascade`);
}
