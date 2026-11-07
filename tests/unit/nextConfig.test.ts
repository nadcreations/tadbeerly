import { readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { describe, expect, test } from "vitest";
import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match";
import nextConfig, { STORED_FILE_ROUTE_SEGMENTS } from "../../next.config";

/** The headers next.config sends for a path, matched the way Next's router matches them. */
async function headersFor(path: string): Promise<Record<string, string>> {
  const rules = (await nextConfig.headers?.()) ?? [];
  const sent: Record<string, string> = {};
  for (const rule of rules) {
    const matches = getPathMatch(rule.source, { strict: true, removeUnnamedParams: true });
    if (matches(path) === false) continue;
    // A later rule wins for the same key, as in Next.
    for (const header of rule.headers) sent[header.key] = header.value;
  }
  return sent;
}

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return routeFiles(path);
    return /^route\.(ts|tsx|js)$/.test(entry.name) ? [path] : [];
  });
}

describe("security headers", () => {
  test("every page and route sends them, the root included", async () => {
    for (const path of [
      "/",
      "/login",
      "/admin/agents",
      "/help/signing-in",
      "/invitations/abc",
      "/api/cron/notifications",
      "/downloads",
    ]) {
      expect(await headersFor(path), path).toEqual({
        "X-Frame-Options": "DENY",
        "Content-Security-Policy": "frame-ancestors 'none'",
        "Referrer-Policy": "strict-origin-when-cross-origin",
        "X-Content-Type-Options": "nosniff",
      });
    }
  });

  test("a stored-file route keeps serveStoredFile's own sandbox policy", async () => {
    for (const path of [
      "/tickets/1/attachments/2/download",
      "/tickets/1/attachments/2/preview",
    ]) {
      // No site-wide CSP here: Next would let it replace the route's sandbox policy.
      expect(await headersFor(path), path).toEqual({
        "X-Frame-Options": "DENY",
        "Referrer-Policy": "strict-origin-when-cross-origin",
        "X-Content-Type-Options": "nosniff",
      });
    }
  });

  test("every route that serves stored files follows that convention", () => {
    const servingFiles = routeFiles("src/app").filter((file) =>
      readFileSync(file, "utf8").includes("serveStoredFile"),
    );
    for (const file of servingFiles) {
      expect(STORED_FILE_ROUTE_SEGMENTS, file).toContain(basename(dirname(file)));
    }
  });
});
