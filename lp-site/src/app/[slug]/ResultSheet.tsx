"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { SHORT_SHARE_HEADING } from "@/lp/ShortToolView";
import { ShareButtons } from "./ToolSection";

export type OtherTool = { slug: string; title: string; version: number };

// 結果が出てから欄を出すまでの間（先に、ツールの結果の画面を見てもらう）
export const RESULT_SHEET_DELAY = 1500;

// 遊びのツール（短いページ）で、結果が出たあとに下から出す欄: シェア と ほかの遊び（運営者の依頼。遊び終わったら、次の遊びに進めるように）
// - 結果が出たことは、ツールの labShare・labResult の知らせ（ToolFrame が lab-result-shown として流す）で知る。
//   遊びが続くツール（#72 のように、見つけても終わらないもの）は quiet を付けて知らせ、遊びの途中で欄が開いて操作を隠さないようにする
// - 自動で開くのは最初の1回だけ。閉じたあとは、上の帯の「シェア・ほかの遊び」で開き直せる
//   （入れるたびに結果の一文を知らせるツールもあるので、毎回開くと遊ぶ邪魔になる）
// - シェアのボタンは、閉じている間も置いておく（結果の一文と番号の知らせを取りこぼさないように）
// menu: 遊ぶ画面（ShortToolView の play）で、上の帯の代わりに使う形。ボタンを最初から出し（label）、欄にサイトの入口（home）と、ひとこと（feedback）も入れる（運営者が決めた）
export function ResultSheet({ slug, version, shareText, results, others, menu }: { slug: string; version: number; shareText: string; results?: string[]; others: OtherTool[]; menu?: { label: string; home: ReactNode; feedback?: ReactNode } }) {
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let shown = false;
    const on = () => {
      if (shown) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        shown = true;
        setSeen(true);
        setOpen(true);
      }, RESULT_SHEET_DELAY);
    };
    // ツールが「静かに」知らせた結果（遊びが続くツールの途中の結果。labShare(…, { quiet: true })）では開かない（ToolFrame が lab-result-shown を流さない）
    window.addEventListener("lab-result-shown", on);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("lab-result-shown", on);
    };
  }, []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <>
      {menu ? (
        // ツールの上に浮かせるので、明るいツールでも暗いツールでも読める色にする
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="rounded-full bg-black/55 px-3 py-1 text-xs font-bold text-white shadow backdrop-blur">
          {menu.label}
        </button>
      ) : (
        seen && (
          <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="rounded-full border border-[color:var(--border)] px-3 py-1 text-xs font-bold">
            シェア・ほかの遊び
          </button>
        )
      )}
      <div
        role="dialog"
        aria-label="シェアとほかの遊び"
        aria-hidden={!open}
        inert={!open}
        className={`fixed inset-x-0 bottom-0 z-40 transition-transform duration-300 ${open ? "translate-y-0" : "pointer-events-none translate-y-full"}`}
      >
        <div className="mx-auto max-h-[85dvh] max-w-3xl overflow-y-auto rounded-t-2xl border border-b-0 border-[color:var(--border)] bg-[color:var(--bg)] px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-8px_30px_rgba(0,0,0,0.18)]">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-bold">{SHORT_SHARE_HEADING}</p>
            <button type="button" onClick={() => setOpen(false)} aria-label="閉じる" className="-mr-2 grid size-9 shrink-0 place-items-center rounded-full text-xl leading-none text-ink-2">×</button>
          </div>
          <div className="mt-2">
            <ShareButtons slug={slug} version={version} text={shareText} results={results} />
          </div>
          {others.length > 0 && (
            <>
              <p className="mt-4 text-sm font-bold">ほかの遊び</p>
              <ul className="mt-2 grid max-w-xl grid-cols-3 gap-2">
                {others.map((t) => (
                  <li key={t.slug}>
                    {/* s=related は「サイトの中から来た」の目印（ダッシュボードで分けて数える） */}
                    <Link href={`/${t.slug}?s=related`} className="block overflow-hidden rounded-lg border border-[color:var(--border)]">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/${t.slug}/opengraph-image?v=${t.version}`} alt="" loading="lazy" className="aspect-[1200/630] w-full object-cover" />
                      <span className="line-clamp-2 p-1.5 text-xs font-bold">{t.title}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
          {menu?.feedback && <div className="mt-4">{menu.feedback}</div>}
          {menu && <p className="mt-4 text-center text-xs text-ink-2">{menu.home}</p>}
        </div>
      </div>
    </>
  );
}
