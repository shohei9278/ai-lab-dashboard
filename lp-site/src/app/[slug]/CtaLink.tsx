"use client";

import { gaEvent } from "@/lib/ga";
import { lpButtonClass, lpButtonStyle } from "@/lp/LpView";

// ページ上部の登録ボタン。押されたかをGAに記録する
export function CtaLink({ slug, version, href = "#signup", children }: { slug: string; version: number; href?: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      onClick={() => gaEvent("cta_click", { lp_slug: slug, lp_version: version, position: "top" })}
      className={lpButtonClass}
      style={lpButtonStyle}
    >
      {children}
    </a>
  );
}
