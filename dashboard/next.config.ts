import type { NextConfig } from "next";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

// R2 credentials live in the repo-root .env.local alongside the other Supabase
// edge-runtime secrets. Load them here so server-only code (e.g., lib/r2.ts)
// can reach them via process.env without duplicating creds into
// dashboard/.env.local. dashboard/.env.local (Supabase URL + anon + service
// role) is still loaded automatically by Next and takes precedence for any
// overlapping keys.
const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, "..", ".env.local") });

const nextConfig: NextConfig = {
  async redirects() {
    return [
      { source: "/app/devices", destination: "/app/screens", permanent: true },
      { source: "/app/devices/:path*", destination: "/app/screens/:path*", permanent: true },
      { source: "/app/stores", destination: "/app/locations", permanent: true },
      { source: "/app/stores/:path*", destination: "/app/locations/:path*", permanent: true },
      { source: "/app/device-groups", destination: "/app/screen-groups", permanent: true },
      { source: "/app/device-groups/:path*", destination: "/app/screen-groups/:path*", permanent: true },
      { source: "/app/screens/pair", destination: "/app/screens/add", permanent: true },
    ];
  },
};

export default nextConfig;
