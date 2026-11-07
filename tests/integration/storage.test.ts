import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { serveStoredFile } from "@/lib/fileResponse";
import {
  MAX_FILE_BYTES,
  deleteFile,
  dispositionFor,
  fileExists,
  formatBytes,
  getFile,
  putFile,
  storageBackend,
} from "@/lib/storage";

let root: string;
const saved: Record<string, string | undefined> = {};
const KEYS = [
  "STORAGE_BACKEND",
  "STORAGE_ROOT",
  "NETLIFY",
  "NETLIFY_BLOBS_CONTEXT",
  "AWS_LAMBDA_FUNCTION_NAME",
];

beforeAll(async () => {
  for (const k of KEYS) saved[k] = process.env[k];
  root = resolve(await mkdtemp(join(tmpdir(), "tb-storage-")));
  process.env.STORAGE_BACKEND = "local";
  process.env.STORAGE_ROOT = root;
});

afterAll(async () => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  await rm(root, { recursive: true, force: true });
});

describe("local storage", () => {
  test("local round trip with checksum", async () => {
    const f = await putFile(Buffer.from("hello"), { folder: "org-1/tickets/t-1", fileName: "note.txt" });
    expect(f.checksum).toBe(createHash("sha256").update("hello").digest("hex"));
    expect(f.size).toBe(5);
    expect(f.storageKey).toMatch(/^org-1\/tickets\/t-1\/[0-9a-f-]{36}\.txt$/);
    expect((await getFile(f.storageKey)).toString()).toBe("hello");
    await deleteFile(f.storageKey);
    expect(await fileExists(f.storageKey)).toBe(false);
    await deleteFile(f.storageKey); // already gone is not an error
  });

  test("a hostile file name cannot escape the root", async () => {
    const f = await putFile(Buffer.from("x"), { folder: "org-1/tickets/t-1", fileName: "../../../etc/passwd" });
    expect(resolve(root, f.storageKey).startsWith(root + sep)).toBe(true);
    expect(f.storageKey).not.toContain("..");
    expect(f.storageKey).not.toContain("passwd");
    expect(await fileExists(f.storageKey)).toBe(true);
  });

  test("a client file name only contributes a sanitised extension", async () => {
    const f = await putFile(Buffer.from("x"), { folder: "a", fileName: "Evil.PDF" });
    expect(f.storageKey).toMatch(/\.pdf$/);
    const g = await putFile(Buffer.from("x"), { folder: "a", fileName: "x.p/../d f" });
    expect(g.storageKey).toMatch(/^a\/[0-9a-f-]{36}$/);
  });

  test("a key that walks out of the root is refused", async () => {
    await expect(getFile("../outside.txt")).rejects.toThrow(/outside the storage root/);
    await expect(putFile(Buffer.from("x"), { folder: "../escape" })).rejects.toThrow(/outside the storage root/);
  });

  test("named files never overwrite each other", async () => {
    const a = await putFile(Buffer.from("1"), { folder: "n", name: "doc", fileName: "a.txt" });
    const b = await putFile(Buffer.from("2"), { folder: "n", name: "doc", fileName: "a.txt" });
    expect(a.storageKey).toBe("n/doc.txt");
    expect(b.storageKey).toBe("n/doc (2).txt");
    expect((await getFile(a.storageKey)).toString()).toBe("1");
  });
});

describe("backend selection", () => {
  test("explicit STORAGE_BACKEND wins", () => {
    process.env.STORAGE_BACKEND = "local";
    process.env.NETLIFY_BLOBS_CONTEXT = "x";
    expect(storageBackend()).toBe("local");
    delete process.env.NETLIFY_BLOBS_CONTEXT;
  });

  test("detects Netlify Blobs when unconfigured, else local", () => {
    delete process.env.STORAGE_BACKEND;
    delete process.env.NETLIFY;
    delete process.env.NETLIFY_BLOBS_CONTEXT;
    expect(storageBackend()).toBe("local");
    process.env.NETLIFY_BLOBS_CONTEXT = "x";
    expect(storageBackend()).toBe("netlify-blobs");
    delete process.env.NETLIFY_BLOBS_CONTEXT;
    process.env.STORAGE_BACKEND = "local";
  });

  test("serverless without a blob store stays on local disk", () => {
    delete process.env.STORAGE_BACKEND;
    delete process.env.NETLIFY;
    delete process.env.NETLIFY_BLOBS_CONTEXT;
    process.env.AWS_LAMBDA_FUNCTION_NAME = "plain-lambda";
    expect(storageBackend()).toBe("local");
    delete process.env.AWS_LAMBDA_FUNCTION_NAME;
    process.env.STORAGE_BACKEND = "local";
  });
});

describe("helpers and serving", () => {
  test("limits, sizes and dispositions", () => {
    expect(MAX_FILE_BYTES).toBe(10 * 1024 * 1024);
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(dispositionFor("application/pdf")).toBe("inline");
    expect(dispositionFor("text/html")).toBe("attachment");
  });

  test("serveStoredFile sets nosniff, the sandbox CSP and the disposition", async () => {
    const f = await putFile(Buffer.from("<script>1</script>"), { folder: "s", fileName: "p.html" });
    const res = await serveStoredFile({ storageKey: f.storageKey, fileName: 'a"b.html', mimeType: "text/html" });
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Content-Security-Policy")).toBe("default-src 'none'; sandbox");
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="a_b.html"');
    expect(await res.text()).toBe("<script>1</script>");
    const missing = await serveStoredFile({ storageKey: "s/nope", fileName: "n", mimeType: "text/plain" });
    expect(missing.status).toBe(410);
  });
});
