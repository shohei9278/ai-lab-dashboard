"use client";

import { useEffect, useRef, useState } from "react";

// AIが作ったツールを、隔離された枠（sandbox）の中で動かす
// - allow-same-origin を付けないので、ツールからはこのサイトの Cookie・保存領域・ページに触れない
// - 結果の画像の保存（ダウンロード）とコピーだけは許す。別のページを開く・移動することはできない
// - CSP で外部への通信や外部ファイルの読み込みを止める
// - 枠の高さと「使われたか」は、こちらで差し込む小さなスクリプトが知らせる（ツールの中身に頼らない）
const CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:";
const BRIDGE = `<script>(function(){var u=false;function h(){parent.postMessage({__lab:"height",h:Math.ceil(document.documentElement.scrollHeight)},"*")}
function use(){if(u)return;u=true;parent.postMessage({__lab:"use"},"*")}
addEventListener("load",h);if(window.ResizeObserver){new ResizeObserver(h).observe(document.documentElement)}setTimeout(h,300);
addEventListener("pointerdown",use,true);addEventListener("keydown",use,true);})();</script>`;

export function wrapToolHtml(html: string): string {
  const head = `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${CSP}">`;
  return `<!doctype html><html lang="ja"><head>${head}</head><body>${html}${BRIDGE}</body></html>`;
}

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
