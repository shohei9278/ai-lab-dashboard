"use client";

import { useEffect, useRef, useState } from "react";
import { answerStore, localBackend, memoryBackend, storeKey as keyOf, type StoreBackend } from "./toolStore";
import { motionGate } from "./toolMotion";
import type { ToolImages } from "./content";
import { wrapToolHtml } from "./toolHtml";

// AIが作ったツールを、隔離された枠（sandbox）の中で動かす（枠の中身の組み立ては toolHtml.ts）
// - allow-same-origin を付けないので、ツールからはこのサイトの Cookie・保存領域・ページに触れない
// - 結果の画像の保存（ダウンロード）とコピーだけは許す。別のページを開く・移動することはできない
// - スマホの動きのセンサー（加速度・ジャイロ）の知らせは、枠の中にも届くようにする（振って遊ぶツールのため。運営者が #72 で見つけた）
//   iPhone は枠の中からの許可の求めを断るので、ツールが window.labMotion で頼んだら、ページの側で許可を求めて動きを渡す（toolMotion.ts）
// - storeKey: 公開サイトのツールの名前（p72 など）。あれば、枠からの記録（window.labStore）をブラウザに残す。なければその場だけ（プレビュー）
// fill: 枠の高さを中身に合わせず、親の高さいっぱいにする（遊びのツールの全画面。中身が長ければ枠の中でスクロールする）
// images: じっくり案件で人が入れた画像（素材）。枠の中で window.labAssets.images として読める
export function ToolFrame({ html, title, onUse, data, fonts, illustration, images, fill = false, storeKey }: { html: string; title: string; onUse?: () => void; data?: unknown[]; fonts?: boolean; illustration?: string; images?: ToolImages; fill?: boolean; storeKey?: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(480);
  const used = useRef(false);
  const store = useRef<StoreBackend | null>(null);
  // 動きのセンサーの窓口（許可・最初の知らせの確かめ・枠への中継は toolMotion.ts の motionGate）。ask: ボタンを出しているか
  const [ask, setAsk] = useState(false);
  const gate = useRef<ReturnType<typeof motionGate> | null>(null);
  useEffect(() => {
    gate.current = motionGate({
      api: () => window.DeviceMotionEvent as unknown as { requestPermission?: () => Promise<string> } | undefined,
      listen: (on) => {
        const h = (e: DeviceMotionEvent) => on(e.accelerationIncludingGravity);
        window.addEventListener("devicemotion", h);
        return () => window.removeEventListener("devicemotion", h);
      },
      send: (m) => ref.current?.contentWindow?.postMessage(m, "*"),
      reply: (id, state) => ref.current?.contentWindow?.postMessage({ __lab: "motion-state", id, state }, "*"),
      showButton: setAsk,
    });
    return () => gate.current?.dispose();
  }, []);

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.source !== ref.current?.contentWindow || typeof e.data !== "object" || !e.data) return;
      store.current ??= storeKey ? localBackend() : memoryBackend();
      const ans = answerStore(e.data, storeKey ? keyOf(storeKey) : "preview", store.current);
      if (ans) { ref.current?.contentWindow?.postMessage(ans, "*"); return; }
      // ツールが動きのセンサーを頼んだら、ページの側で許可を求める（許可が要らない端末はそのまま。求めて断られたら、ボタンでのタップを待つ）
      if (e.data.__lab === "motion-request" && typeof e.data.id === "number") {
        gate.current?.request(e.data.id);
        return;
      }
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
  }, [onUse, storeKey]);

  return (
    <div style={{ position: "relative", height: fill ? "100%" : undefined }}>
    <iframe
      ref={ref}
      title={title}
      sandbox="allow-scripts allow-downloads"
      allow="clipboard-write; accelerometer; gyroscope"
      srcDoc={wrapToolHtml(html, { data, fonts, illustration, images, fill })}
      style={{ width: "100%", height: fill ? "100%" : height, border: 0, display: "block" }}
    />
    {ask && (
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, padding: 16, background: "rgba(6,10,26,.62)", color: "#fff", textAlign: "center" }}>
        <button type="button" onClick={() => gate.current?.tap()} style={{ minHeight: 48, padding: "0 22px", borderRadius: 999, border: 0, background: "#fff", color: "#141a2a", fontSize: 15, fontWeight: 700 }}>
          センサーを使う
        </button>
        <p style={{ margin: 0, fontSize: 12, lineHeight: 1.6 }}>スマホを振ったり傾けたりして遊ぶために、動きのセンサーを使います。<br />この端末では、ここで一度許可が要ります。</p>
        <button type="button" onClick={() => gate.current?.decline()} style={{ minHeight: 36, padding: "0 16px", borderRadius: 999, border: "1px solid rgba(255,255,255,.5)", background: "transparent", color: "#fff", fontSize: 12, fontWeight: 700 }}>
          使わない
        </button>
      </div>
    )}
    </div>
  );
}
