import type { NextConfig } from "next";

/**
 * The last path segment of every route that streams a stored file, such as
 * `/tickets/[id]/attachments/[attachmentId]/download`.
 *
 * Those routes answer with serveStoredFile, whose own Content-Security-Policy
 * sandboxes the file so uploaded HTML can never run in this origin. Next keeps
 * a header set in this file over a route's own header of the same name, so the
 * site-wide policy below must skip these paths or it would replace the
 * sandbox. tests/unit/nextConfig.test.ts holds every serveStoredFile route to
 * this convention.
 */
export const STORED_FILE_ROUTE_SEGMENTS = ["download", "preview"];

const notAStoredFile = `(?!(?:.*/)?(?:${STORED_FILE_ROUTE_SEGMENTS.join("|")})$)`;

const nextConfig: NextConfig = {
  /**
   * `next build` and `next dev` write incompatible module manifests. Sharing
   * one directory leaves the dev server resolving client components against a
   * production manifest, which surfaces as an opaque
   * "Cannot read properties of undefined (reading 'call')" at render time.
   *
   * `npm run build:check` sets this so a verification build never disturbs a
   * running dev server. Deployment builds leave it unset and use `.next`.
   */
  distDir: process.env.NEXT_DIST_DIR ?? ".next",

  experimental: {
    // Server Actions handle all mutations in this app.
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },

  /**
   * Security headers. No page is meant to be framed (clickjacking), no
   * response should be sniffed into another type, and a link to another site
   * should not carry our full URLs, which can hold tokens, in its Referer.
   */
  async headers() {
    return [
      {
        // Every route, the root included (Next's matcher skips "/" for "/:path*").
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
      {
        // Every route except stored-file routes, which send their own sandbox
        // policy (see STORED_FILE_ROUTE_SEGMENTS above).
        source: `/:path(${notAStoredFile}.*)`,
        headers: [{ key: "Content-Security-Policy", value: "frame-ancestors 'none'" }],
      },
    ];
  },
};

export default nextConfig;
