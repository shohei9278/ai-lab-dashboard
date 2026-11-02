import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "playwright-core"],
  // 上の階層にある別の lockfile を、このアプリの起点と勘違いしないようにする
  outputFileTracingRoot: process.cwd(),
};

export default nextConfig;
