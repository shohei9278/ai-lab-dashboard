"use client";

import { gaEvent } from "@/lib/ga";

// ページ上部の登録ボタン。押されたかをGAに記録する
export function CtaLink({ slug, version, children }: { slug: string; version: number; children: React.ReactNode }) {
  return (
    <a
      href="#signup"
      onClick={() => gaEvent("cta_click", { lp_slug: slug, lp_version: version, position: "top" })}
      className="inline-block rounded-full bg-accent px-6 py-3 font-medium text-accent-ink"
    >
      {children}
    </a>
  );
}
