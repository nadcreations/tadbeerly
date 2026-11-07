import { eq, sql, type SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { organizations, users } from "@/db/schema";
import { allTableNames } from "./db";

/** Empties every table, so each test starts from nothing. */
export async function resetDb(): Promise<void> {
  const names = await allTableNames();
  if (names.length === 0) return;
  const list = sql.join(
    names.map((n) => sql.identifier(n)),
    sql`, `,
  );
  await db.execute(sql`truncate table ${list} restart identity cascade`);
}

let orgSeq = 0;

/** A bare organization. */
export async function makeOrg(name?: string) {
  const [org] = await db
    .insert(organizations)
    .values({ name: name ?? `Org ${++orgSeq} ${crypto.randomUUID().slice(0, 8)}` })
    .returning();
  return org;
}

export async function orgByName(name: string) {
  const [org] = await db
    .select()
    .from(organizations)
    .where(sql`lower(${organizations.name}) = lower(${name})`);
  return org;
}

export async function userById(id: string) {
  const [user] = await db.select().from(users).where(eq(users.id, id));
  return user;
}

export async function count(table: PgTable, where?: SQL): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(table)
    .where(where);
  return row.n;
}
