import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

const PHYSICAL =
  /(?<![\w-])(?:-?(?:ml|mr|pl|pr)-|(?:left|right)-|text-(?:left|right)\b|border-(?:l|r)\b|border-(?:l|r)-|rounded-(?:l|r|tl|tr|bl|br)\b|rounded-(?:l|r|tl|tr|bl|br)-)/;
// CSS declarations with physical sides (globals.css and inline styles).
const PHYSICAL_CSS =
  /(?:^|[\s;{])(?:padding|margin|border)-(?:left|right)\s*:|(?:^|[\s;{])(?:left|right)\s*:\s*[^;}\n]/m;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return files(p);
    return /\.(ts|tsx|css)$/.test(name) ? [p] : [];
  });
}
const read = (f: string) => readFileSync(f, "utf8");

test("UI uses logical direction utilities only", () => {
  // Email HTML keeps physical CSS: Outlook ignores logical properties.
  const offenders = files("src")
    .filter((f) => !f.replace(/\\/g, "/").startsWith("src/lib/email/"))
    .filter(
    (f) => PHYSICAL.test(read(f)) || PHYSICAL_CSS.test(read(f)),
  );
  expect(offenders).toEqual([]);
});
