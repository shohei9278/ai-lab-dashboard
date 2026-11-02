"use client";

import { useEffect } from "react";
import { gaEvent } from "@/lib/ga";
import { isExcluded, visitorId } from "./visitor";

// 開いたことを1回だけ記録する。あわせて、どの部分まで読まれたかをGAに送る
export function Tracker({ slug, version }: { slug: string; version: number }) {
  useEffect(() => {
    if (isExcluded()) return;
    fetch("/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // ?s=… は、SNSの投稿ごとに付けた専用リンクの目印（どの投稿から来たかを数えるため）
      body: JSON.stringify({ slug, version, visitorId: visitorId(), referrer: document.referrer.slice(0, 300), source: new URLSearchParams(location.search).get("s") }),
      keepalive: true,
    }).catch(() => {});

    // 各部分（悩み・特徴・よくある質問・登録フォーム）が半分見えたら、1回だけ送る
    const seen = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const section = (e.target as HTMLElement).dataset.section;
          if (!e.isIntersecting || !section || seen.has(section)) continue;
          seen.add(section);
          gaEvent("section_view", { lp_slug: slug, lp_version: version, section });
        }
      },
      { threshold: 0.5 },
    );
    document.querySelectorAll("[data-section]").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [slug, version]);
  return null;
}
