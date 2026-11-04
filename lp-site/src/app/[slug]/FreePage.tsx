"use client";

import { useCallback } from "react";
import { gaEvent } from "@/lib/ga";
import { PageFrame } from "@/lp/PageFrame";
import { isExcluded, visitorId } from "./visitor";

// AIが自由に書いたLPを画面いっぱいに出し、登録の送信とGAのイベントを、枠の外（このページ）で行う
export function FreePage({ slug, version, html, title, imgOrigins, operator }: {
  slug: string; version: number; html: string; title: string; imgOrigins: string[]; operator: string;
}) {
  const onSignup = useCallback(async (email: string, consent: boolean) => {
    const res = await fetch("/api/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, version, email, consent, website: "", visitorId: visitorId(), test: isExcluded() }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    if (res?.ok) {
      gaEvent("sign_up", { lp_slug: slug, lp_version: version, method: "email" });
      return { ok: true };
    }
    gaEvent("sign_up_error", { lp_slug: slug, lp_version: version });
    return { ok: false, message: typeof data.error === "string" ? data.error : undefined };
  }, [slug, version]);
  const onEvent = useCallback((name: string, params: Record<string, unknown>) => {
    if (!["cta_click", "form_start", "scroll_depth"].includes(name)) return;
    const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => typeof v === "string" || typeof v === "number").map(([k, v]) => [k.slice(0, 40), typeof v === "string" ? v.slice(0, 60) : v])) as Record<string, string | number>;
    gaEvent(name, { ...clean, lp_slug: slug, lp_version: version });
  }, [slug, version]);
  return <PageFrame fill html={html} title={title} imgOrigins={imgOrigins} operator={operator} onSignup={onSignup} onEvent={onEvent} />;
}
