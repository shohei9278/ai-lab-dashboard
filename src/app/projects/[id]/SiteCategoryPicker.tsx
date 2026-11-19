"use client";

import { BusyNote, useLoopAction } from "@/components/LoopAction";

// 公開サイト（Hitoride）の一覧で、このツールをどのカテゴリに並べるかを選ぶ（運営者だけ）
// 「AIに任せる」を選ぶと、公開するときに軽いAIがツールの名前と中身から選んだものを使う
export function SiteCategoryPicker({ id, value, options, auto, published }: {
  id: number;
  value: string | null; // 運営者が選んだもの（なければ null）
  options: { key: string; label: string }[];
  auto: string; // AIの判定の説明（選んだカテゴリの名前・合うものなし・公開時に選ぶ（まだ判定していない））
  published: boolean;
}) {
  const { run, busy, error } = useLoopAction();
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-ink-2">
      <label htmlFor={`site-category-${id}`}>公開サイトの一覧のカテゴリ</label>
      <select
        id={`site-category-${id}`}
        value={value ?? ""}
        disabled={!!busy}
        onChange={(e) => run("カテゴリを変えています…", { action: "site-category", projectId: id, category: e.target.value })}
        className="max-w-full rounded border border-line bg-surface px-1.5 py-0.5 text-xs text-ink"
      >
        <option value="">{`AIに任せる（${auto}）`}</option>
        {options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
      </select>
      {published && <span className="text-muted">変えると、公開中のページの一覧にもすぐ反映します</span>}
      <BusyNote busy={busy} error={error} />
    </div>
  );
}
