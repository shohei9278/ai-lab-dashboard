"use client";

import { useEffect, useRef, useState } from "react";
import { wrapToolHtml } from "./toolHtml";

// AIが作ったツールを、隔離された枠（sandbox）の中で動かす（枠の中身の組み立ては toolHtml.ts）
// - allow-same-origin を付けないので、ツールからはこのサイトの Cookie・保存領域・ページに触れない
// - 結果の画像の保存（ダウンロード）とコピーだけは許す。別のページを開く・移動することはできない
export function ToolFrame({ html, title, onUse, data, fonts, illustration }: { html: string; title: string; onUse?: () => void; data?: unknown[]; fonts?: boolean; illustration?: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(480);
  const used = useRef(false);

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.source !== ref.current?.contentWindow || typeof e.data !== "object" || !e.data) return;
      if (e.data.__lab === "height" && typeof e.data.h === "number") setHeight(Math.max(240, Math.min(4000, e.data.h)));
      // ツールが知らせた結果の一文を、ページのシェアのボタンに渡す
      if (e.data.__lab === "share-text" && typeof e.data.text === "string") {
        window.dispatchEvent(new CustomEvent("lab-share-text", { detail: e.data.text.slice(0, 200) }));
      }
      // ツールが知らせた結果の番号を、ページのシェアのボタンに渡す（結果ごとのシェア画像のリンクにする）
      if (e.data.__lab === "result" && typeof e.data.i === "number") {
        window.dispatchEvent(new CustomEvent("lab-share-result", { detail: e.data.i }));
      }
      if (e.data.__lab === "use" && !used.current) {
        used.current = true;
        onUse?.();
      }
    }
    window.addEventListener("message", onMessage);
    // 受け取れるようになる前に枠が読み込まれていると、最初の高さの知らせを取りこぼすので、今の高さを聞き直す
    ref.current?.contentWindow?.postMessage({ __lab: "ping" }, "*");
    return () => window.removeEventListener("message", onMessage);
  }, [onUse]);

  return (
    <iframe
      ref={ref}
      title={title}
      sandbox="allow-scripts allow-downloads"
      allow="clipboard-write"
      srcDoc={wrapToolHtml(html, { data, fonts, illustration })}
      style={{ width: "100%", height, border: 0, display: "block" }}
    />
  );
}
