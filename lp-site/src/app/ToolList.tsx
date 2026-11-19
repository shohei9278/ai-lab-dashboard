"use client";

import { useEffect, useState } from "react";
import type { ListedPage } from "@/lib/supabase";
import { SITE_CATEGORIES, SITE_CATEGORY_KEYS, isSiteCategory } from "@/lp/categories";
import { PageGrid } from "./PageGrid";

// すぐ使えるツールの一覧。各カードにカテゴリのタグ（診断・占い、計算・見積もり など）を付けて1つに並べ、
// 上のボタンで1つのカテゴリだけに絞り込める（カテゴリが多く、件数が少ないうちは、見出しごとに分けると間延びするため）
// カテゴリはダッシュボードが公開の中身に入れたもの。カテゴリがないツールは「そのほか」で絞り込める
// ボタンは、ツールが1件以上あるカテゴリだけ出す。カテゴリが1種類しかないときは、ボタンを出さない
const OTHER = "other";
type Choice = { key: string; label: string; pages: ListedPage[] };

export function ToolList({ tools }: { tools: ListedPage[] }) {
  const choices: Choice[] = [
    ...SITE_CATEGORY_KEYS.map((k) => ({ key: k, label: SITE_CATEGORIES[k].label, pages: tools.filter((t) => t.category === k) })),
    { key: OTHER, label: "そのほか", pages: tools.filter((t) => !isSiteCategory(t.category)) },
  ].filter((c) => c.pages.length > 0);
  const [selected, setSelected] = useState("all");
  // 絞り込みは URL（?c=calc など）にも残す（そのまま人に送れるように）。最初の表示はサーバーと同じ「すべて」にして、読み込んだあとに合わせる
  useEffect(() => {
    const c = new URLSearchParams(window.location.search).get("c");
    // URL に合わせて一度だけ選び直す（外の状態を読む同期なので、ここで state を変える）
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (c && choices.some((x) => x.key === c)) setSelected(c);
    // choices は一覧から毎回作るので、最初の1回だけ見る
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const choose = (key: string) => {
    setSelected(key);
    const url = new URL(window.location.href);
    if (key === "all") url.searchParams.delete("c");
    else url.searchParams.set("c", key);
    window.history.replaceState(null, "", url);
  };

  if (choices.length <= 1) return <PageGrid pages={tools} showTag />;
  const shown = selected === "all" ? tools : choices.find((c) => c.key === selected)?.pages ?? tools;
  return (
    <>
      <div role="group" aria-label="カテゴリで絞り込む" className="mt-4 flex flex-wrap gap-2">
        {[{ key: "all", label: "すべて", count: tools.length }, ...choices.map((c) => ({ key: c.key, label: c.label, count: c.pages.length }))].map((b) => (
          <button
            key={b.key}
            type="button"
            aria-pressed={selected === b.key}
            onClick={() => choose(b.key)}
            className={`rounded-full border px-3 py-1.5 text-sm transition ${selected === b.key ? "border-accent bg-accent text-accent-ink" : "border-black/15 text-ink-2 hover:border-black/40"}`}
          >
            {b.label}<span className="ml-1 tabular-nums opacity-70">{b.count}</span>
          </button>
        ))}
      </div>
      <PageGrid pages={shown} showTag />
    </>
  );
}
