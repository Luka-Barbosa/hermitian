import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native DuckDB bindings must stay outside the bundle.
  serverExternalPackages: ["@duckdb/node-api", "@duckdb/node-bindings"],
};

export default nextConfig;
