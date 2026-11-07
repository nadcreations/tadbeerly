import type { NextConfig } from "next";

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
};

export default nextConfig;
