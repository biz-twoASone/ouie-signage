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
  /* config options here */
};

export default nextConfig;
