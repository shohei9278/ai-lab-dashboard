"use client";

import { useEffect } from "react";
import { gaEvent } from "@/lib/ga";
import { isExcluded, visitorId } from "./visitor";

// 開いたことを1回だけ記録する。あわせて、どの部分まで読まれたかをGAに送る
export function Tracker({ slug, version, scroll = true }: { slug: string; version: number; scroll?: boolean }) {
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
          // 縦に長い部分（スマホのツールなど）は、半分が同時に画面に入らないので、画面の半分以上を占めたら見えたことにする
          const visible = e.isIntersecting && (e.intersectionRatio >= 0.5 || e.intersectionRect.height >= innerHeight * 0.5);
          if (!visible || !section || seen.has(section)) continue;
          seen.add(section);
          gaEvent("section_view", { lp_slug: slug, lp_version: version, section });
        }
      },
      { threshold: [0, 0.1, 0.25, 0.5] },
    );
    document.querySelectorAll("[data-section]").forEach((el) => observer.observe(el));

    // どこまで読んだか（25%ごと。自由にデザインしたページは、枠の中から同じものが届くので、ここでは数えない）
    // 一気に下まで動いたときも、途中の段（75%など）を飛ばさずに送る
    let depth = 0;
    const onScroll = () => {
      const h = document.documentElement;
      const p = Math.floor(((h.scrollTop + innerHeight) / h.scrollHeight) * 4) * 25;
      while (depth < p) {
        depth += 25;
        if (depth >= 50) gaEvent("scroll_depth", { lp_slug: slug, lp_version: version, percent: depth });
      }
    };
    if (scroll) addEventListener("scroll", onScroll, { passive: true });
    return () => {
      observer.disconnect();
      removeEventListener("scroll", onScroll);
    };
  }, [slug, version, scroll]);
  return null;
}
