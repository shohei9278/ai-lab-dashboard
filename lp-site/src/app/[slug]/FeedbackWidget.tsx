"use client";

import { useEffect, useState } from "react";
import { isExcluded, visitorId } from "./visitor";

// 右下の「ひとこと聞かせてください」。匿名・1タップ（名前やメールは聞かない）
// 開いてから少したってから出す。閉じたり送ったりしたら、そのページでは二度と出さない
const OPTIONS = {
  tool: { q: "使ってみて、どうでした？", items: [["useful", "役に立った"], ["confusing", "使い方が分からなかった"], ["not_what_i_want", "欲しいものと違った"], ["other", "その他"]] },
  lp: { q: "登録しなかった理由を、よければ教えてください", items: [["not_now", "今はまだ必要ない"], ["unclear", "内容がよく分からない"], ["distrust", "信用できるか不安"], ["other", "その他"]] },
} as const;

export function FeedbackWidget({ slug, version, kind }: { slug: string; version: number; kind: "lp" | "tool" }) {
  const key = `lp_feedback_${slug}_${version}`;
  const [show, setShow] = useState(false);
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [sent, setSent] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(key)) return;
    } catch {
      // 保存できないブラウザでも出す
    }
    const t = setTimeout(() => setShow(true), kind === "tool" ? 30_000 : 20_000);
    return () => clearTimeout(t);
  }, [key, kind]);

  const done = () => {
    try {
      localStorage.setItem(key, "1");
    } catch {
      // 何もしない
    }
  };
  if (!show) return null;
  const o = OPTIONS[kind];

  if (!open) {
    return (
      <div className="fixed bottom-4 right-4 z-50 flex items-center gap-1 rounded-full border border-black/10 bg-white px-3 py-2 text-sm shadow-lg">
        <button type="button" onClick={() => setOpen(true)} className="font-medium text-neutral-800">ひとこと聞かせてください</button>
        <button type="button" aria-label="閉じる" onClick={() => { done(); setShow(false); }} className="px-1 text-neutral-400">×</button>
      </div>
    );
  }
  return (
    <div className="fixed bottom-4 right-4 z-50 w-[min(92vw,340px)] space-y-3 rounded-2xl border border-black/10 bg-white p-4 text-sm text-neutral-800 shadow-xl">
      {sent ? (
        <div className="space-y-2">
          <p className="font-medium">ありがとうございます。いただいた声は、改善に使います。</p>
          <button type="button" onClick={() => setShow(false)} className="text-neutral-500 underline">閉じる</button>
        </div>
      ) : (
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!choice) return;
            const website = (e.currentTarget.elements.namedItem("website") as HTMLInputElement | null)?.value ?? "";
            await fetch("/api/feedback", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ slug, version, choice, text, website, visitorId: visitorId(), test: isExcluded() }),
              keepalive: true,
            }).catch(() => {});
            done();
            setSent(true);
          }}
        >
          <div className="flex items-start justify-between gap-2">
            <p className="font-medium">{o.q}</p>
            <button type="button" aria-label="閉じる" onClick={() => { done(); setShow(false); }} className="text-neutral-400">×</button>
          </div>
          <div className="flex flex-wrap gap-2">
            {o.items.map(([v, label]) => (
              <button key={v} type="button" onClick={() => setChoice(v)} className={`rounded-full border px-3 py-1 ${choice === v ? "border-neutral-800 bg-neutral-800 text-white" : "border-neutral-300"}`}>
                {label}
              </button>
            ))}
          </div>
          <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={300} rows={2} placeholder="ひとこと（任意）" className="block w-full rounded-lg border border-neutral-300 px-2 py-1" />
          <input name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-neutral-500">匿名です。名前やメールは聞きません</span>
            <button type="submit" disabled={!choice} className="rounded-full bg-neutral-800 px-4 py-1.5 font-medium text-white disabled:opacity-40">送る</button>
          </div>
        </form>
      )}
    </div>
  );
}
