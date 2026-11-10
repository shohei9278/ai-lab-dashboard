import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // このフォルダを基準にする（ダッシュボードの中に公開サイトがあり、自動の判定だと親を見てしまう）
  turbopack: { root: process.cwd() },
  serverExternalPackages: ["better-sqlite3", "playwright-core"],
  // 上の階層にある別の lockfile を、このアプリの起点と勘違いしないようにする
  outputFileTracingRoot: process.cwd(),
};

export default nextConfig;
