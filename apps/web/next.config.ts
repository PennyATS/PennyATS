import { existsSync } from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

// The .env file lives at the repo root, but Next only reads env files from apps/web.
// Load the root file too. Variables already set in the environment win.
const rootEnv = path.resolve(process.cwd(), "../../.env");
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

// Baseline security headers on every response (#121, docs/threat-model.md). A Content
// Security Policy is tracked separately because Next's inline scripts need nonces.
const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  ...((process.env.APP_URL ?? "").startsWith("https://")
    ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]
    : []),
];

const config: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
  // Standalone output is for the Docker image only (docker/Dockerfile sets this variable).
  // Building it creates symlinks, which fail on Windows without Developer Mode.
  output: process.env.PENNYATS_STANDALONE === "1" ? "standalone" : undefined,
  outputFileTracingRoot: path.resolve(process.cwd(), "../.."),
  transpilePackages: ["@pennyats/db", "@pennyats/ai", "@pennyats/redact", "@pennyats/schema"],
  experimental: {
    // Resume uploads go through server actions; the default limit is 1 MB.
    serverActions: { bodySizeLimit: "6mb" },
  },
};

export default config;
