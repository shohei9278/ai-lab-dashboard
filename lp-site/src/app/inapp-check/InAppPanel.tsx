"use client";

import { useEffect, useState } from "react";
import { fitScale } from "@/lp/inApp";

// アプリの中のブラウザの確かめ用ページで、画面の上に出す情報と、画面の下の端からの目盛り
// 運営者が X などのアプリから開いてスクリーンショットを撮り、見分け（data-inapp）が効いたか・帯がどこまで重なるかを読むためのもの
// - アプリが上の帯の分だけページを下にずらしているか（ずれは 100dvh に入らない）を、その場で測れるかも出す。運営者の考え:
//   アプリごとの目測の余白ではなく、見えている範囲をその場で測り、遊ぶ画面は上の帯を取って、ツールを縮めて収める
export function InAppPanel() {
  const [info, setInfo] = useState<[string, string][]>([]);
  const [open, setOpen] = useState(true);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const probe = document.createElement("div");
    probe.style.cssText = "position:fixed;left:0;top:0;width:1px;height:100dvh;visibility:hidden;pointer-events:none";
    document.body.appendChild(probe);
    // iPhone が知らせる安全な余白（viewport-fit=cover のときに入る）を、padding に入れて読む
    const safe = document.createElement("div");
    safe.style.cssText = "position:fixed;left:0;top:0;width:1px;height:1px;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)";
    document.body.appendChild(safe);
    const read = () => {
      const html = document.documentElement;
      const topGap = getComputedStyle(html).getPropertyValue("--lab-inapp-top").trim() || "なし";
      // ツールの枠（遊ぶ画面では、上の細い帯の下の部分）
      const tool = (document.querySelector("#tool > div") ?? document.getElementById("tool"))?.getBoundingClientRect();
      const frame = tool?.height ?? 0;
      const top = (el: Element | null) => (el ? Math.round(el.getBoundingClientRect().top) : NaN);
      const vv = window.visualViewport;
      const sp = getComputedStyle(safe);
      setInfo([
        ["アプリの中と見分けた", html.hasAttribute("data-inapp") ? `はい（${html.getAttribute("data-inapp") || "?"}・${html.getAttribute("data-inapp-src") === "effect" ? "読み込み後に付け直した" : "描く前に付いた"}）` : "いいえ"],
        ["上に空けた高さ（--lab-inapp-top）", topGap],
        ["ツールを縮める割合", tool ? `${Math.round(fitScale(tool.width, tool.height).scale * 100)}%` : "-"],
        ["画面の高さ（innerHeight）", `${window.innerHeight}px`],
        ["見えている高さ（visualViewport）", `${Math.round(window.visualViewport?.height ?? 0)}px`],
        ["100dvh", `${Math.round(probe.getBoundingClientRect().height)}px`],
        ["ツールの枠の高さ", `${Math.round(frame)}px`],
        ["ページの上の端の位置（html の top）", `${top(html)}px`],
        ["上の帯（Hitoride）の位置（top）", `${top(document.querySelector("main header"))}px`],
        ["ツールの枠の上と下（top / bottom）", `${Math.round(tool?.top ?? NaN)}px / ${Math.round(tool?.bottom ?? NaN)}px`],
        ["枠の下の端と、画面の下の端の差（innerHeight − bottom）", `${Math.round(window.innerHeight - (tool?.bottom ?? NaN))}px`],
        ["スクロールの位置（scrollY）", `${Math.round(window.scrollY)}px`],
        ["見えている範囲のずれ（visualViewport の offsetTop / pageTop）", `${Math.round(vv?.offsetTop ?? NaN)}px / ${Math.round(vv?.pageTop ?? NaN)}px`],
        ["端末の画面（screen の height / availHeight）", `${window.screen.height}px / ${window.screen.availHeight}px`],
        ["安全な余白（env safe-area-inset の 上 / 下 / 左 / 右）", `${sp.paddingTop} / ${sp.paddingBottom} / ${sp.paddingLeft} / ${sp.paddingRight}`],
        ["画面の幅", `${window.innerWidth}px（${window.devicePixelRatio}倍）`],
        ["ブラウザの名乗り（UA）", navigator.userAgent],
        ["来た元（referrer）", document.referrer || "なし"],
        ["URL のパラメーター", location.search || "なし"],
      ]);
    };
    read();
    const t = setInterval(read, 1000);
    window.addEventListener("resize", read);
    window.visualViewport?.addEventListener("resize", read);
    return () => {
      clearInterval(t);
      window.removeEventListener("resize", read);
      window.visualViewport?.removeEventListener("resize", read);
      probe.remove();
      safe.remove();
    };
  }, []);
  const text = info.map(([k, v]) => `${k}: ${v}`).join("\n");
  return (
    <>
      {/* 画面（表示している範囲）の下の端からの目盛り。右の端に出す（枠の中の目盛りは左） */}
      <div aria-hidden className="pointer-events-none fixed bottom-0 right-0 z-30 h-[200px] w-16">
        {Array.from({ length: 21 }, (_, i) => i * 10).map((y) => (
          <div key={y} className="absolute right-0 border-t" style={{ bottom: y, width: y % 50 === 0 ? 40 : 22, borderColor: y % 50 === 0 ? "#ff6b6b" : "rgba(255,120,120,.7)" }}>
            {y % 20 === 0 && <span className="absolute -top-2 right-[42px] rounded bg-black/70 px-1 text-[10px] font-bold leading-4 text-[#ff9b9b]">{y}</span>}
          </div>
        ))}
      </div>
      <div className="fixed left-2 top-28 z-40 max-w-[78vw] rounded-lg bg-black/80 p-2 text-[10px] leading-snug text-white">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setOpen((v) => !v)} className="rounded bg-white/20 px-2 py-1 font-bold">{open ? "たたむ" : "情報を出す"}</button>
          {open && (
            <button type="button" onClick={() => navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }, () => {})} className="rounded bg-white/20 px-2 py-1 font-bold">
              {copied ? "コピーしました" : "コピー"}
            </button>
          )}
        </div>
        {open && (
          <dl className="mt-1 space-y-0.5">
            {info.map(([k, v]) => (
              <div key={k}>
                <dt className="inline text-white/60">{k}: </dt>
                <dd className="inline break-all">{v}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </>
  );
}
