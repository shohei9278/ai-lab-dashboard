"use client";

import { useEffect, useRef, useState } from "react";
import { wrapPageHtml } from "./pageHtml";

export type SignupResult = { ok: boolean; message?: string };

// AIが丸ごと自由に書いたLPを、隔離された枠（sandbox）の中で表示する（枠の中身の組み立ては pageHtml.ts）
// - allow-same-origin を付けないので、ページからはこのサイトの Cookie・保存領域に触れない。別のページへの移動もできない
// - 公開サイトでは画面1つ分の高さで出す（枠の中でスクロールするので、AIの書いた 100vh や固定のヘッダーがそのまま効く）
//   画面に固定はしない。枠の下に、検索エンジンにも読める概要と、ほかのツールへの案内を置くため（枠の中を下まで読むと、続けてページが動く）
// autoHeight: 枠の高さを中身に合わせる（ツールの案件で、ページを上下2つの枠に分けて出すとき。枠の中ではスクロールしない）
export function PageFrame({
  html, title, imgOrigins, operator, fill, height = 760, autoHeight, onBackground, onMissing, seek, onSignup, onEvent,
}: {
  autoHeight?: boolean;
  // autoHeight の枠で、ページ内のリンクの行き先がこの枠の中にないとき（ツールの #tool・もう一方の枠の中）
  onMissing?: (id: string) => void;
  // この枠の中に id があれば、そこまで親のページをスクロールする（n を変えるたびに聞く）
  seek?: { id: string; n: number };
  onBackground?: (color: string) => void; // ページの背景色（ツールのまわりを同じ色にするため）
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
  const [autoH, setAutoH] = useState(120);

  useEffect(() => {
    const send = (m: object) => ref.current?.contentWindow?.postMessage({ ...m }, "*");
    async function onMessage(e: MessageEvent) {
      if (e.source !== ref.current?.contentWindow || typeof e.data !== "object" || !e.data) return;
      const d = e.data as Record<string, unknown>;
      if (d.__lab === "ready") send({ __lab: "init", operator: operator ?? "" });
      // 高さは中身のとおりにする（よくある質問を全部開くなどで長くなっても切らない。おかしな数字だけ弾く）
      if (autoHeight && d.__lab === "height" && typeof d.h === "number" && Number.isFinite(d.h)) setAutoH(Math.max(40, Math.min(1_000_000, d.h)));
      // 色の書き方（rgb(…)・rgba(…)）だけを受け取る
      if (d.__lab === "bg" && typeof d.color === "string" && /^rgba?\([\d\s.,]+\)$/.test(d.color)) onBackground?.(d.color);
      // ページ内のリンク: 高さを中身に合わせた枠は枠の中でスクロールしないので、親のページを、枠の位置＋枠の中の位置までスクロールする
      if (autoHeight && d.__lab === "jump" && typeof d.id === "string") {
        if (typeof d.y === "number" && Number.isFinite(d.y) && ref.current) {
          window.scrollTo({ top: ref.current.getBoundingClientRect().top + window.scrollY + Math.max(0, d.y), behavior: "smooth" });
        } else if (d.y === null) onMissing?.(d.id.slice(0, 100));
      }
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
    // 受け取れるようになる前に枠が読み込まれていると、準備ができた知らせ（運営者名を送る合図）や最初の高さを取りこぼすので聞き直す
    ref.current?.contentWindow?.postMessage({ __lab: "ping" }, "*");
    return () => window.removeEventListener("message", onMessage);
  }, [operator, onSignup, onEvent, autoHeight, onBackground, onMissing]);

  useEffect(() => {
    if (seek) ref.current?.contentWindow?.postMessage({ __lab: "where", id: seek.id }, "*");
  }, [seek]);

  return (
    <iframe
      ref={ref}
      title={title}
      // allow-forms が無いと送信のイベント自体が起きない。実際の送信先への移動は、CSP の form-action で止める
      sandbox="allow-scripts allow-forms"
      srcDoc={wrapPageHtml(html, { imgOrigins })}
      style={autoHeight
        ? { width: "100%", height: autoH, border: 0, display: "block" }
        : fill
        ? { width: "100%", height: "100dvh", border: 0, display: "block", background: "#fff" }
        : { width: "100%", height, border: 0, display: "block" }}
    />
  );
}
