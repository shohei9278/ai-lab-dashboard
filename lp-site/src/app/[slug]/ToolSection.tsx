"use client";

import { useCallback, useEffect, useState } from "react";
import { gaEvent } from "@/lib/ga";
import { ToolFrame } from "@/lp/ToolFrame";
import { lpButtonClass, lpButtonStyle } from "@/lp/LpView";
import { isExcluded, visitorId } from "./visitor";

function record(slug: string, version: number, kind: "use" | "share") {
  if (isExcluded()) return;
  fetch("/api/event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slug, version, kind, visitorId: visitorId() }),
    keepalive: true,
  }).catch(() => {});
}

// ツール本体。最初に操作されたときに「使った」と記録する
export function ToolSection({ slug, version, html, title }: { slug: string; version: number; html: string; title: string }) {
  const onUse = useCallback(() => {
    record(slug, version, "use");
    gaEvent("tool_use", { lp_slug: slug, lp_version: version });
  }, [slug, version]);
  return <ToolFrame html={html} title={title} onUse={onUse} />;
}

// シェアのボタン（X とリンクのコピー）
export function ShareButtons({ slug, version, text }: { slug: string; version: number; text: string }) {
  const [copied, setCopied] = useState(false);
  const shared = (method: string) => {
    record(slug, version, "share");
    gaEvent("share", { lp_slug: slug, lp_version: version, method });
  };
  const [url, setUrl] = useState("");
  useEffect(() => setUrl(window.location.href.split("#")[0]), []);
  return (
    <div className="flex flex-wrap justify-center gap-3">
      <a
        href={`https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`}
        target="_blank"
        rel="noreferrer"
        onClick={() => shared("x")}
        className={lpButtonClass}
        style={lpButtonStyle}
      >
        X でシェア
      </a>
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            shared("copy");
          } catch {}
        }}
        className="rounded-full border border-[color:var(--border)] px-6 py-3 font-bold"
      >
        {copied ? "コピーしました" : "リンクをコピー"}
      </button>
    </div>
  );
}
