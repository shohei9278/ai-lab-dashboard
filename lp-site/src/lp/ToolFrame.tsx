"use client";

import { useEffect, useRef, useState } from "react";
import { wrapToolHtml } from "./toolHtml";

// AIが作ったツールを、隔離された枠（sandbox）の中で動かす（枠の中身の組み立ては toolHtml.ts）
// - allow-same-origin を付けないので、ツールからはこのサイトの Cookie・保存領域・ページに触れない
// - 結果の画像の保存（ダウンロード）とコピーだけは許す。別のページを開く・移動することはできない
export function ToolFrame({ html, title, onUse }: { html: string; title: string; onUse?: () => void }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(480);
  const used = useRef(false);

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.source !== ref.current?.contentWindow || typeof e.data !== "object" || !e.data) return;
      if (e.data.__lab === "height" && typeof e.data.h === "number") setHeight(Math.max(240, Math.min(4000, e.data.h)));
      if (e.data.__lab === "use" && !used.current) {
        used.current = true;
        onUse?.();
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [onUse]);

  return (
    <iframe
      ref={ref}
      title={title}
      sandbox="allow-scripts allow-downloads"
      allow="clipboard-write"
      srcDoc={wrapToolHtml(html)}
      style={{ width: "100%", height, border: 0, display: "block" }}
    />
  );
}
