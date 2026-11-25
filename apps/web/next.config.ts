import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@pennyats/db", "@pennyats/ai", "@pennyats/redact"],
};

export default config;
