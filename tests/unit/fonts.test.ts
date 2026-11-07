import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, test } from "vitest";

/*
 * Fonts are self-hosted. next/font/google downloads font CSS and files from
 * Google at build time, and on Netlify Google served a font URL without a file
 * extension, which next/font's loader cannot parse — the deploy failed. A
 * build must never depend on a third-party network fetch.
 */

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe("fonts", () => {
  test("nothing imports next/font/google", () => {
    const offenders = sourceFiles("src").filter((f) =>
      /from\s+["']next\/font\/google["']/.test(readFileSync(f, "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  test("the root layout loads IBM Plex through next/font/local", () => {
    const fonts = readFileSync("src/app/fonts.ts", "utf8");
    expect(fonts).toContain('from "next/font/local"');
    expect(fonts).toContain('variable: "--font-plex-sans"');
    expect(fonts).toContain('variable: "--font-plex-mono"');
    expect(readFileSync("src/app/layout.tsx", "utf8")).toContain('from "./fonts"');
  });

  test("every referenced font file exists and the licence ships with them", () => {
    const fonts = readFileSync("src/app/fonts.ts", "utf8");
    const paths = [...fonts.matchAll(/path: "([^"]+\.woff2)"/g)].map((m) => m[1]);
    // Sans 400/500/600/700 and Mono 400/500/600, as before.
    expect(paths).toHaveLength(7);
    for (const p of paths) {
      expect(existsSync(resolve(dirname("src/app/fonts.ts"), p)), p).toBe(true);
    }
    expect(existsSync("src/app/fonts/OFL.txt")).toBe(true);
  });
});
