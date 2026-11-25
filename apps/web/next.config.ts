import { existsSync } from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

// The .env file lives at the repo root, but Next only reads env files from apps/web.
// Load the root file too. Variables already set in the environment win.
const rootEnv = path.resolve(process.cwd(), "../../.env");
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const config: NextConfig = {
  // Standalone output is for the Docker image only (docker/Dockerfile sets this variable).
  // Building it creates symlinks, which fail on Windows without Developer Mode.
  output: process.env.PENNYATS_STANDALONE === "1" ? "standalone" : undefined,
  outputFileTracingRoot: path.resolve(process.cwd(), "../.."),
  transpilePackages: ["@pennyats/db", "@pennyats/ai", "@pennyats/redact"],
  experimental: {
    // Resume uploads go through server actions; the default limit is 1 MB.
    serverActions: { bodySizeLimit: "6mb" },
  },
};

export default config;
