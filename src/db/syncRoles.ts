/**
 * Grants newly-added system permissions to existing organizations.
 *
 * Roles store their permission list as data, cloned from the templates when
 * the organization was created, so a new key in SYSTEM_ROLE_TEMPLATES does not
 * reach existing organizations by itself. This is additive and touches system
 * roles only: customisations (extra keys) survive.
 *
 * Run after any change to SYSTEM_ROLE_TEMPLATES:  npm run db:sync-roles
 */
import { pathToFileURL } from "node:url";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { roles } from "@/db/schema";
import { SYSTEM_ROLE_TEMPLATES } from "@/lib/permissions";

export async function syncRoles(): Promise<{ updated: number }> {
  const templates = new Map(SYSTEM_ROLE_TEMPLATES.map((t) => [t.key, t]));
  const rows = await db.select().from(roles).where(eq(roles.isSystem, true));

  let updated = 0;
  for (const row of rows) {
    const template = templates.get(row.key);
    if (!template) continue;
    const current = new Set(row.permissions ?? []);
    const missing = template.permissions.filter((p) => !current.has(p));
    if (missing.length === 0) continue;
    await db
      .update(roles)
      .set({ permissions: [...current, ...missing] })
      .where(eq(roles.id, row.id));
    updated += 1;
  }
  return { updated };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  syncRoles()
    .then(({ updated }) => {
      console.log(
        updated === 0
          ? "All system roles already match the templates."
          : `Updated ${updated} role${updated === 1 ? "" : "s"}.`,
      );
      process.exit(0);
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
