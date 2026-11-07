import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, stat, writeFile, unlink } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { netlifyBlobsReachable } from "@/lib/runtime";

/**
 * File storage behind a narrow interface.
 *
 * Three backends, chosen once at startup:
 *
 *  - **SharePoint**, when files must live under an organization's own
 *    retention, eDiscovery and backup policy. The bytes sit in a document
 *    library; who may read them stays with Tadbeerly, because a requester with
 *    no SharePoint account still has to open the attachments on their request.
 *  - **Netlify Blobs**, for anything running on Netlify. Serverless functions
 *    get a read-only filesystem with an ephemeral /tmp, so a file written to
 *    disk is gone by the next request — an upload would appear to succeed and
 *    then vanish, which for a ticket attachment is worse than refusing it.
 *  - **Local disk**, for development and for anywhere self-hosted. It needs no
 *    external service, so a clone of this repository runs with a database and
 *    nothing else.
 *
 * Storage keys are server-generated UUIDs — never a client-supplied filename —
 * so an upload cannot traverse out of the storage root or overwrite anything.
 * The key format is shared by both backends, so a file uploaded under one is
 * addressable under the other and a migration is a copy rather than a rewrite.
 */

export type StoredFile = {
  storageKey: string;
  checksum: string;
  size: number;
};

/**
 * Which backend is in use.
 *
 * An explicit setting always wins, so a self-hosted deployment on a machine
 * that happens to set NETLIFY is never surprised. Otherwise Netlify is
 * detected, because getting this wrong there loses files silently.
 */
export type StorageBackend = "sharepoint" | "netlify-blobs" | "local";

export function storageBackend(): StorageBackend {
  const configured = process.env.STORAGE_BACKEND?.trim().toLowerCase();
  if (configured === "sharepoint") return "sharepoint";
  if (configured === "netlify-blobs") return "netlify-blobs";
  if (configured === "local") return "local";
  /*
   * Nothing is inferred for SharePoint — it has to be asked for. Guessing at a
   * backend that needs a tenant, a site and a secret would fail confusingly;
   * guessing wrong on Netlify loses files silently, which is why that one is
   * detected.
   *
   * `NETLIFY` alone is not enough: it is set while a site is built and not
   * while its functions run, where only the blobs context exists (see
   * src/lib/runtime.ts). This asks whether a blob store can actually be
   * reached, not merely whether this is serverless: a plain AWS Lambda has no
   * blob store, so `isServerlessRuntime()` would be the wrong question here.
   */
  if (process.env.NETLIFY || netlifyBlobsReachable()) return "netlify-blobs";
  return "local";
}

/** One store for the whole site, so files outlive the deploy that wrote them. */
const STORE_NAME = process.env.NETLIFY_BLOBS_STORE ?? "tadbeerly-documents";

async function sharePoint() {
  // Imported on the path that uses it, so the other backends never load Graph.
  const module = await import("@/lib/sharepoint");
  return { module, config: module.sharePointConfig() };
}

async function store() {
  // Imported here rather than at the top so the local-disk path never loads it.
  const { getStore } = await import("@netlify/blobs");
  return getStore({
    name: STORE_NAME,
    /*
     * Inside a Netlify function these are supplied by the platform and both
     * are undefined here, which is correct. Set explicitly, they let a
     * maintenance script reach the same store from a developer's machine —
     * which is the only way to migrate what is already in it.
     */
    siteID: process.env.NETLIFY_SITE_ID,
    token: process.env.NETLIFY_AUTH_TOKEN,
    /*
     * Strong consistency, because a document is read straight after it is
     * written — an attachment is opened the moment it is uploaded. Under the
     * default eventual consistency that read can miss, and the file would
     * appear to be missing rather than merely late.
     */
    consistency: "strong",
  });
}

/* ------------------------------- local disk ------------------------------- */

/** Read per call rather than at import, so tests can point it at a temp dir. */
function storageRoot(): string {
  return resolve(process.env.STORAGE_ROOT ?? join(process.cwd(), "storage"));
}

function pathForKey(storageKey: string): string {
  const root = storageRoot();
  const target = resolve(root, storageKey);
  // Defence in depth: even though keys are generated, never resolve outside root.
  if (target !== root && !target.startsWith(root + sep)) {
    throw new Error("Refusing to access a path outside the storage root.");
  }
  return target;
}

/* -------------------------------- the API --------------------------------- */

/**
 * The original file's extension, if it has one worth keeping.
 *
 * Taken from a client-supplied name, so it is treated as hostile: lower-cased,
 * and only letters and digits survive. Anything else — a path separator, a
 * second dot, a hundred characters of nonsense — is dropped rather than
 * repaired.
 */
function safeExtension(fileName: string | undefined): string {
  if (!fileName) return "";
  const dot = fileName.lastIndexOf(".");
  if (dot === -1 || dot === fileName.length - 1) return "";
  const candidate = fileName.slice(dot + 1).toLowerCase();
  return /^[a-z0-9]{1,10}$/.test(candidate) ? `.${candidate}` : "";
}

/** Whether something is already stored under this key. */
export async function fileExists(storageKey: string): Promise<boolean> {
  if (storageBackend() === "sharepoint") {
    const { module, config } = await sharePoint();
    return module.itemExists(config, storageKey);
  }

  if (storageBackend() === "netlify-blobs") {
    const blobs = await store();
    return (await blobs.getMetadata(storageKey)) !== null;
  }

  try {
    await stat(pathForKey(storageKey));
    return true;
  } catch {
    return false;
  }
}

export type PutOptions = {
  /**
   * Where the file lives, supplied by the caller and never by the client,
   * e.g. `${organizationId}/tickets/${ticketId}`.
   */
  folder: string;
  /** A folder inside it. */
  subfolder?: string;
  /**
   * What to call the file, without its extension. Omitted, a UUID is used.
   *
   * Must be server-chosen and already safe as a path segment (no slashes, no
   * `..`): this function does not sanitise it, because a caller that forgot
   * would otherwise be silently rescued and the next one would forget too.
   * pathForKey still refuses any key that resolves outside the storage root.
   */
  name?: string;
  /**
   * The name the file arrived with. Used only for its extension.
   *
   * Without an extension neither SharePoint nor the operating system knows what
   * the file is, so it will not preview and will not open after download.
   */
  fileName?: string;
};

/**
 * A key nothing is stored under yet.
 *
 * Readable names collide in ways UUIDs cannot. Rather than let the second
 * overwrite the first, which would silently destroy a stored file, the second
 * becomes `name (2)`.
 */
async function freeKey(prefix: string, name: string, ext: string): Promise<string> {
  for (let attempt = 1; attempt <= 50; attempt += 1) {
    const candidate = `${prefix}${name}${attempt === 1 ? "" : ` (${attempt})`}${ext}`;
    if (!(await fileExists(candidate))) return candidate;
  }
  // Fifty names taken is not a collision, it is a bug somewhere upstream —
  // but refusing the upload would be the wrong way to report it.
  return `${prefix}${name}-${randomUUID()}${ext}`;
}

export async function putFile(
  data: Buffer,
  options: PutOptions,
): Promise<StoredFile> {
  // Forward slashes throughout: a path on disk, a prefix in a blob store.
  const prefix = `${options.folder}/${options.subfolder ? `${options.subfolder}/` : ""}`;
  const ext = safeExtension(options.fileName);

  const storageKey = options.name
    ? await freeKey(prefix, options.name, ext)
    : `${prefix}${randomUUID()}${ext}`;

  const stored: StoredFile = {
    storageKey,
    checksum: createHash("sha256").update(data).digest("hex"),
    size: data.byteLength,
  };

  if (storageBackend() === "sharepoint") {
    const { module, config } = await sharePoint();
    await module.uploadFile(config, storageKey, data);
    return stored;
  }

  if (storageBackend() === "netlify-blobs") {
    const blobs = await store();
    await blobs.set(
      storageKey,
      /*
       * Copied out to its own ArrayBuffer rather than passed as a view: Node
       * pools small Buffers, so `data.buffer` is frequently a larger shared
       * allocation holding several unrelated values, and handing that over
       * would store the neighbours too.
       */
      new Uint8Array(data).buffer as ArrayBuffer,
    );
    return stored;
  }

  const target = pathForKey(storageKey);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, data);
  return stored;
}

export async function getFile(storageKey: string): Promise<Buffer> {
  if (storageBackend() === "sharepoint") {
    const { module, config } = await sharePoint();
    return module.downloadFile(config, storageKey);
  }

  if (storageBackend() === "netlify-blobs") {
    const blobs = await store();
    const data = await blobs.get(storageKey, { type: "arrayBuffer" });
    /*
     * Thrown rather than returned as null, because every caller already knows
     * how to handle a missing file — the download route answers 410 — and a
     * null slipping through would be a zero-byte download instead.
     */
    if (!data) {
      throw new Error(`No stored file for key ${storageKey}.`);
    }
    return Buffer.from(data);
  }

  return readFile(pathForKey(storageKey));
}

export async function deleteFile(storageKey: string): Promise<void> {
  if (storageBackend() === "sharepoint") {
    const { module, config } = await sharePoint();
    await module.removeFile(config, storageKey);
    return;
  }

  if (storageBackend() === "netlify-blobs") {
    // Deleting something already gone is not an error in either backend.
    const blobs = await store();
    await blobs.delete(storageKey);
    return;
  }

  try {
    await unlink(pathForKey(storageKey));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") throw error;
  }
}

/** Upload ceiling; keep in step with serverActions.bodySizeLimit in next.config. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Content types we will serve inline. Everything else downloads as an
 * attachment — never let an uploaded file render as HTML in our origin.
 */
const INLINE_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "text/plain",
]);

export function dispositionFor(mimeType: string): "inline" | "attachment" {
  return INLINE_TYPES.has(mimeType) ? "inline" : "attachment";
}
