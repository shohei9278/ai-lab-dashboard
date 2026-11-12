import type { MetadataRoute } from "next";
import { listPages } from "@/lib/supabase";
import { SITE_URL } from "@/lib/site";

// 公開中のページの一覧（検索エンジン向け）。受付を終えたページは載せない。5分ごとに読み直す
export const revalidate = 300;

const base = SITE_URL;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { tools, lps } = await listPages();
  return [
    { url: `${base}/`, changeFrequency: "daily", priority: 1 },
    ...tools.map((p) => ({ url: `${base}/${p.slug}`, changeFrequency: "weekly" as const, priority: 0.8 })),
    ...lps.map((p) => ({ url: `${base}/${p.slug}`, changeFrequency: "weekly" as const, priority: 0.5 })),
    { url: `${base}/privacy`, changeFrequency: "yearly", priority: 0.1 },
  ];
}
