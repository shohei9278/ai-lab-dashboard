import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // このフォルダを基準にする（ダッシュボードの中に公開サイトがあり、自動の判定だと親を見てしまう）
  turbopack: { root: process.cwd() },
  /* config options here */
};

export default nextConfig;
