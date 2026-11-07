/**
 * A client-credentials token for Microsoft Graph.
 *
 * Lifted out of the SharePoint client so the mail transport can use it too.
 * Both authenticate as the same application against the same tenant, so they
 * should hold one token between them rather than each fetching its own and
 * refreshing it on its own schedule — the cache key is unchanged from when this
 * lived in `sharepoint.ts`, so nothing already running notices the move.
 */

export type GraphCredentials = {
  tenantId: string;
  clientId: string;
  clientSecret: string;
};

const REQUEST_TIMEOUT_MS = 8000;

/*
 * Cached on the module, which on a serverless platform means for the life of
 * the container. A token lasts about an hour, so re-fetching it per request
 * would add a round trip to every call for nothing.
 */
type Cached = { token: string; expiresAt: number };
const globalForGraph = globalThis as unknown as { __tbGraphToken?: Cached };

export async function graphToken(
  credentials: GraphCredentials,
): Promise<string> {
  const cached = globalForGraph.__tbGraphToken;
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  const response = await fetch(
    `https://login.microsoftonline.com/${credentials.tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials",
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  );

  const body = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };

  if (!response.ok || !body.access_token) {
    /*
     * Named plainly, because the two ways this fails look identical from the
     * outside and have completely different fixes: a wrong secret, and a
     * secret that quietly expired.
     */
    throw new Error(
      `Microsoft sign-in failed (${response.status} ${body.error ?? "unknown"}): ` +
        `${(body.error_description ?? "").split("\r")[0].slice(0, 200)}`,
    );
  }

  globalForGraph.__tbGraphToken = {
    token: body.access_token,
    // A minute early, so a token never expires mid-request.
    expiresAt: Date.now() + ((body.expires_in ?? 3600) - 60) * 1000,
  };
  return body.access_token;
}

/**
 * Throw the cached token away.
 *
 * A stale one would otherwise fail every call until the container recycled, so
 * a 401 is worth one retry with a fresh token.
 */
export function forgetGraphToken(): void {
  delete globalForGraph.__tbGraphToken;
}

/**
 * The application's Graph credentials.
 *
 * `GRAPH_*` first, then the `SHAREPOINT_*` names, because the app registration
 * that stores documents is normally the same one that sends the mail and
 * nobody should have to write the same secret twice. Returns null rather than
 * throwing: a caller that has no Graph configured is a configuration state, not
 * an error.
 */
export function graphCredentials(): GraphCredentials | null {
  const tenantId =
    process.env.GRAPH_TENANT_ID ?? process.env.SHAREPOINT_TENANT_ID;
  const clientId =
    process.env.GRAPH_CLIENT_ID ?? process.env.SHAREPOINT_CLIENT_ID;
  const clientSecret =
    process.env.GRAPH_CLIENT_SECRET ?? process.env.SHAREPOINT_CLIENT_SECRET;

  if (!tenantId || !clientId || !clientSecret) return null;
  return { tenantId, clientId, clientSecret };
}
