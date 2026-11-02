"use client";

import { useEffect } from "react";
import { visitorId } from "./visitor";

// 開いたことを1回だけ記録する
export function Tracker({ slug, version }: { slug: string; version: number }) {
  useEffect(() => {
    fetch("/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, version, visitorId: visitorId(), referrer: document.referrer.slice(0, 300) }),
      keepalive: true,
    }).catch(() => {});
  }, [slug, version]);
  return null;
}
