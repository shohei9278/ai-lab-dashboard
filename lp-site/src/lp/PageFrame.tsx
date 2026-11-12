"use client";

import { useEffect, useRef } from "react";
import { wrapPageHtml } from "./pageHtml";

export type SignupResult = { ok: boolean; message?: string };

// AIが丸ごと自由に書いたLPを、隔離された枠（sandbox）の中で表示する（枠の中身の組み立ては pageHtml.ts）
// - allow-same-origin を付けないので、ページからはこのサイトの Cookie・保存領域に触れない。別のページへの移動もできない
// - 公開サイトでは画面1つ分の高さで出す（枠の中でスクロールするので、AIの書いた 100vh や固定のヘッダーがそのまま効く）
//   画面に固定はしない。枠の下に、検索エンジンにも読める概要と、ほかのツールへの案内を置くため（枠の中を下まで読むと、続けてページが動く）
export function PageFrame({
  html, title, imgOrigins, operator, fill, height = 760, onSignup, onEvent,
}: {
  html: string;
  title: string;
  imgOrigins?: string[];
  operator?: string;
  fill?: boolean;
  height?: number;
  onSignup?: (email: string, consent: boolean) => Promise<SignupResult>;
  onEvent?: (name: string, params: Record<string, unknown>) => void;
}) {
  const ref = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const send = (m: object) => ref.current?.contentWindow?.postMessage({ ...m }, "*");
    async function onMessage(e: MessageEvent) {
      if (e.source !== ref.current?.contentWindow || typeof e.data !== "object" || !e.data) return;
      const d = e.data as Record<string, unknown>;
      if (d.__lab === "ready") send({ __lab: "init", operator: operator ?? "" });
      if (d.__lab === "open" && d.path === "/privacy") window.open("/privacy", "_blank", "noopener");
      if (d.__lab === "event" && typeof d.name === "string") onEvent?.(d.name.slice(0, 40), (typeof d.params === "object" && d.params ? d.params : {}) as Record<string, unknown>);
      if (d.__lab === "signup") {
        const r = onSignup
          ? await onSignup(String(d.email ?? "").slice(0, 254), d.consent === true)
          : { ok: false, message: "プレビューのため送信しません" };
        send({ __lab: "signup-result", ...r });
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [operator, onSignup, onEvent]);

  return (
    <iframe
      ref={ref}
      title={title}
      // allow-forms が無いと送信のイベント自体が起きない。実際の送信先への移動は、CSP の form-action で止める
      sandbox="allow-scripts allow-forms"
      srcDoc={wrapPageHtml(html, { imgOrigins })}
      style={fill
        ? { width: "100%", height: "100dvh", border: 0, display: "block", background: "#fff" }
        : { width: "100%", height, border: 0, display: "block" }}
    />
  );
}
