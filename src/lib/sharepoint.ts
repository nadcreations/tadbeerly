/**
 * Microsoft Graph, as much of it as document storage needs.
 *
 * The application authenticates as itself — a client-credentials token against
 * an Entra ID app registration holding `Sites.Selected` on one site. No user is
 * involved, and none should be: an external reviewer who has never heard of
 * SharePoint still needs to open a drawing that was issued to them, and Tadbeerly's
 * own rules decide whether they may. SharePoint holds the bytes; it does not
 * hold the question of who may read them.
 *
 * Everything here is bounded. Tokens are cached until shortly before they
 * expire, throttling is honoured rather than hammered through, and every call
 * gives up after a few seconds — this runs inside a request on a platform that
 * will kill the whole function if a socket hangs.
 */

import { forgetGraphToken, graphToken } from "@/lib/graphToken";

const GRAPH = "https://graph.microsoft.com/v1.0";

/** Graph takes a straight PUT up to this; anything larger needs a session. */
const SIMPLE_UPLOAD_LIMIT = 4 * 1024 * 1024;
/** Chunks must be a multiple of 320 KiB. 3.2 MB keeps requests comfortably small. */
const CHUNK_SIZE = 320 * 1024 * 10;
const REQUEST_TIMEOUT_MS = 8000;
const MAX_RETRIES = 3;

export type SharePointConfig = {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  /** Host of the site collection, e.g. contoso.sharepoint.com */
  host: string;
  /** Server-relative path, e.g. /sites/Tadbeerly */
  sitePath: string;
  /** Display name of the document library. */
  library: string;
  /** Optional folder inside the library, so Tadbeerly's files sit together. */
  root: string;
};

export function sharePointConfig(): SharePointConfig {
  const required = (name: string): string => {
    const value = process.env[name];
    if (!value) {
      throw new Error(
        `STORAGE_BACKEND=sharepoint requires ${name}. See .env.example.`,
      );
    }
    return value;
  };

  /*
   * The site is given as a URL because that is what somebody can copy from
   * their browser. Splitting it here means nobody has to know that Graph wants
   * the host and the path separately.
   */
  const siteUrl = new URL(required("SHAREPOINT_SITE_URL"));

  return {
    tenantId: required("SHAREPOINT_TENANT_ID"),
    clientId: required("SHAREPOINT_CLIENT_ID"),
    clientSecret: required("SHAREPOINT_CLIENT_SECRET"),
    host: siteUrl.host,
    sitePath: siteUrl.pathname.replace(/\/$/, ""),
    library: process.env.SHAREPOINT_LIBRARY ?? "Documents",
    root: (process.env.SHAREPOINT_ROOT ?? "").replace(/^\/|\/$/g, ""),
  };
}

/*
 * The drive id is cached on the module, which on a serverless platform means
 * for the life of the container — it changes effectively never, and looking it
 * up per request would add a round trip to every download for nothing. The
 * access token is cached the same way, in `graphToken`, which the mail
 * transport shares.
 */
const globalForGraph = globalThis as unknown as { __tbGraphDrive?: string };

/** A Graph call with the token attached, throttling honoured, and a deadline. */
async function graph(
  config: SharePointConfig,
  path: string,
  init: RequestInit = {},
  attempt = 1,
): Promise<Response> {
  const token = await graphToken(config);
  const url = path.startsWith("http") ? path : `${GRAPH}${path}`;

  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(
      `SharePoint could not be reached: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  /*
   * Graph throttles with 429 and says how long to wait. Ignoring that and
   * retrying immediately is how a busy moment turns into a longer one. 503 and
   * 504 are transient in the same way.
   */
  if ([429, 503, 504].includes(response.status) && attempt < MAX_RETRIES) {
    const retryAfter = Number(response.headers.get("retry-after") ?? "1");
    // Bounded, because the caller is a request with its own budget.
    const waitMs = Math.min(Math.max(retryAfter, 1), 3) * 1000;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    return graph(config, path, init, attempt + 1);
  }

  // A stale cached token would otherwise fail every call until the container
  // recycled. One retry with a fresh one costs nothing.
  if (response.status === 401 && attempt < MAX_RETRIES) {
    forgetGraphToken();
    return graph(config, path, init, attempt + 1);
  }

  return response;
}

async function describe(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  try {
    const parsed = JSON.parse(text) as { error?: { code?: string; message?: string } };
    if (parsed.error) {
      return `${parsed.error.code ?? response.status}: ${(parsed.error.message ?? "").slice(0, 200)}`;
    }
  } catch {
    /* not JSON */
  }
  return `${response.status} ${text.slice(0, 200)}`;
}

/** The document library's drive id, looked up once by display name. */
export async function driveId(config: SharePointConfig): Promise<string> {
  if (globalForGraph.__tbGraphDrive) return globalForGraph.__tbGraphDrive;

  const response = await graph(
    config,
    `/sites/${config.host}:${config.sitePath}:/drives`,
  );
  if (!response.ok) {
    throw new Error(`Cannot list document libraries — ${await describe(response)}`);
  }

  const body = (await response.json()) as {
    value?: { id: string; name: string }[];
  };
  const match = body.value?.find((drive) => drive.name === config.library);
  if (!match) {
    const found = (body.value ?? []).map((d) => d.name).join(", ");
    throw new Error(
      `No document library named "${config.library}" on ${config.sitePath}. Found: ${found || "none"}`,
    );
  }

  globalForGraph.__tbGraphDrive = match.id;
  return match.id;
}

/**
 * A storage key as a Graph item path.
 *
 * Keys are `${folder}/${uuid}` — generated, never client-supplied — but the
 * segments are encoded anyway. Defence here costs nothing and the alternative
 * is trusting that no future caller ever passes something else.
 */
function itemPath(config: SharePointConfig, storageKey: string): string {
  const segments = [
    ...(config.root ? config.root.split("/") : []),
    ...storageKey.split("/"),
  ].filter(Boolean);

  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw new Error("Refusing a storage key that walks the path.");
  }

  return segments.map(encodeURIComponent).join("/");
}

export async function uploadFile(
  config: SharePointConfig,
  storageKey: string,
  data: Buffer,
): Promise<void> {
  const drive = await driveId(config);
  const path = itemPath(config, storageKey);

  if (data.byteLength <= SIMPLE_UPLOAD_LIMIT) {
    const response = await graph(config, `/drives/${drive}/root:/${path}:/content`, {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream" },
      body: new Uint8Array(data),
    });
    if (!response.ok) {
      throw new Error(`Upload failed — ${await describe(response)}`);
    }
    return;
  }

  /*
   * Larger files go through an upload session: Graph refuses a single PUT over
   * 4 MB. The session is a URL that accepts ranges and needs no further
   * authentication, which is why the chunk requests use plain fetch.
   */
  const session = await graph(
    config,
    `/drives/${drive}/root:/${path}:/createUploadSession`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        item: { "@microsoft.graph.conflictBehavior": "replace" },
      }),
    },
  );
  if (!session.ok) {
    throw new Error(`Could not start an upload — ${await describe(session)}`);
  }
  const { uploadUrl } = (await session.json()) as { uploadUrl: string };

  const total = data.byteLength;
  for (let start = 0; start < total; start += CHUNK_SIZE) {
    const end = Math.min(start + CHUNK_SIZE, total) - 1;
    const chunk = data.subarray(start, end + 1);

    let response: Response;
    try {
      response = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Length": String(chunk.byteLength),
          "Content-Range": `bytes ${start}-${end}/${total}`,
        },
        body: new Uint8Array(chunk),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      await fetch(uploadUrl, { method: "DELETE" }).catch(() => {});
      throw new Error(
        `Upload interrupted at ${start} of ${total} bytes: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // 202 means the chunk landed and more are expected; 200/201 is the last one.
    if (![200, 201, 202].includes(response.status)) {
      // Abandon the session rather than leaving a half-written item behind.
      await fetch(uploadUrl, { method: "DELETE" }).catch(() => {});
      throw new Error(
        `Upload failed at ${start} of ${total} bytes — ${await describe(response)}`,
      );
    }
  }
}

export async function downloadFile(
  config: SharePointConfig,
  storageKey: string,
): Promise<Buffer> {
  const drive = await driveId(config);
  const path = itemPath(config, storageKey);

  const response = await graph(config, `/drives/${drive}/root:/${path}:/content`, {
    redirect: "follow",
  });

  if (response.status === 404) {
    // Matches the other backends: absent is an error the caller already knows
    // how to answer, with 410 rather than an empty download.
    throw new Error(`No stored file for key ${storageKey}.`);
  }
  if (!response.ok) {
    throw new Error(`Download failed — ${await describe(response)}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

/** Whether an item is already there. Used to avoid overwriting a stored file. */
export async function itemExists(
  config: SharePointConfig,
  storageKey: string,
): Promise<boolean> {
  const drive = await driveId(config);
  const path = itemPath(config, storageKey);
  const response = await graph(config, `/drives/${drive}/root:/${path}`);
  // Consume the body so the socket is released rather than left to time out.
  await response.text().catch(() => "");
  return response.ok;
}

export async function removeFile(
  config: SharePointConfig,
  storageKey: string,
): Promise<void> {
  const drive = await driveId(config);
  const path = itemPath(config, storageKey);

  const response = await graph(config, `/drives/${drive}/root:/${path}`, {
    method: "DELETE",
  });

  // Already gone is not a failure — cleanup after a rolled-back upload runs
  // over files that were never written.
  if (response.ok || response.status === 404) return;
  throw new Error(`Delete failed — ${await describe(response)}`);
}
