import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { loadEnv, requireEnv } from "@/lib/env";

/**
 * The database handle.
 *
 * Connected on first use rather than on import. `next build` loads every route
 * module to collect page data, so anything demanded at module scope is
 * demanded at build time — and a build machine has no reason to hold a
 * production database password. Deferring it means a build needs no secrets
 * while a misconfigured deployment still fails loudly on its first request,
 * which is where the mistake is actually visible.
 */

type Database = ReturnType<typeof drizzle<typeof schema>>;

// Next dev reloads modules on every edit; without caching this leaks pools.
const globalForDb = globalThis as unknown as {
  __tbClient?: ReturnType<typeof postgres>;
  __tbDb?: Database;
};

function connectionString(): string {
  /*
   * Netlify's Neon extension provisions a database and exposes it under its
   * own name. Reading that as a fallback means a deployment using the
   * extension works without anyone copying the URL into a second variable —
   * but DATABASE_URL still wins, so an explicit setting is never quietly
   * overridden.
   */
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  if (process.env.NETLIFY_DATABASE_URL) return process.env.NETLIFY_DATABASE_URL;
  // Throws naming the variable and how to set it.
  return requireEnv("DATABASE_URL");
}

function connect(): Database {
  if (globalForDb.__tbDb) return globalForDb.__tbDb;

  // Next loads .env.local itself; standalone scripts do not.
  loadEnv();

  const client =
    globalForDb.__tbClient ??
    postgres(connectionString(), {
      /*
       * One connection per instance on serverless, ten on a long-lived server.
       *
       * A Netlify function is short-lived and there are many of them at once,
       * so a pool of ten per instance multiplies into hundreds of connections
       * against a database that allows far fewer — and the failure is not a
       * slow page but a refused connection under exactly the load that caused
       * it. A long-running server has the opposite problem and wants the pool.
       */
      max: process.env.NETLIFY ? 1 : 10,
      /*
       * Neon closes idle connections, and a serverless instance is idle
       * between invocations. Giving up on an unreachable socket quickly beats
       * holding a request open until the platform times it out.
       */
      idle_timeout: process.env.NETLIFY ? 20 : undefined,
      connect_timeout: 10,
      // Set TB_SQL_DEBUG=1 to print every statement with its parameters.
      debug:
        process.env.TB_SQL_DEBUG === "1"
          ? (_conn, query, params) =>
              console.log("\n[sql]", query, "\n[params]", params)
          : undefined,
    });

  if (process.env.NODE_ENV !== "production") {
    globalForDb.__tbClient = client;
  }

  const instance = drizzle(client, { schema });
  globalForDb.__tbDb = instance;
  return instance;
}

/**
 * Proxied so `db.select(...)` reads exactly as it always did while the
 * connection is still made on first touch. Methods are bound to the real
 * instance, or drizzle's internals lose their `this`.
 */
export const db = new Proxy({} as Database, {
  get(_target, property, receiver) {
    const instance = connect();
    const value = Reflect.get(instance, property, receiver);
    return typeof value === "function" ? value.bind(instance) : value;
  },
  has(_target, property) {
    return property in connect();
  },
});

export { schema };

/** Anything that can run queries: the handle itself or a transaction. */
export type Executor = Pick<
  typeof db,
  "insert" | "select" | "update" | "delete" | "execute"
>;
