import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";

/**
 * Hosts Next.js may serve dev assets (HMR, chunks) to besides localhost.
 *
 * Sharing is tested from a phone through an HTTPS tunnel, and Next 16 blocks
 * cross-origin dev resources by default — which silently breaks client-side
 * hydration, so the login form renders but never reacts. `*.ngrok-free.dev`
 * covers the rotating free-tier subdomain; `*.ngrok-free.app` and
 * `*.ngrok.io` cover the other common aliases. Only the dev server reads this.
 */
const ALLOWED_DEV_ORIGINS = [
  "*.ngrok-free.dev",
  "*.ngrok-free.app",
  "*.ngrok.io",
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // A stray lockfile in the parent directory makes Turbopack guess the wrong
  // project root, so pin it to this project explicitly.
  turbopack: {
    root: dirname(fileURLToPath(import.meta.url)),
  },
  allowedDevOrigins: ALLOWED_DEV_ORIGINS,
};

export default nextConfig;
