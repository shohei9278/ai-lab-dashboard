import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// 検索エンジンへの案内。ページは全部見てよい（APIは見なくてよい）。ページの一覧は sitemap.xml にある
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", allow: "/", disallow: "/api/" }, sitemap: `${SITE_URL}/sitemap.xml` };
}
