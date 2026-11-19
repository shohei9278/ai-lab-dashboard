import type { ReactNode } from "react";

// 遊び・毎日のお題など（ねらいが「広がる」「また来てもらう」）のツールの、短いページ: 名前と一行 → ツール → シェア
// 紹介ページ（悩み・手順・称号の一覧など）は作らない。触れば分かり、説明はネタばらしになりやすく、読まれないため（content.ts の short）
// 運営者名とプライバシーポリシーは、サイト全体の下の欄に出る
// ツールの下のシェアの欄の見出し（公開サイトとダッシュボードのプレビューで同じ文にする）
export const SHORT_SHARE_HEADING = "楽しかったら、シェアしてもらえるとうれしいです";

export function ShortToolView({ title, lead, tool, after }: { title: string; lead: string; tool: ReactNode; after?: ReactNode }) {
  return (
    <div>
      <header className="mx-auto max-w-3xl px-4 pb-3 pt-6 text-center">
        <h1 className="text-xl font-bold sm:text-2xl">{title}</h1>
        {lead && <p className="mt-1 text-sm text-ink-2">{lead}</p>}
      </header>
      <section id="tool" data-section="tool" className="px-4 pb-8">
        <div className="mx-auto max-w-3xl overflow-hidden rounded-2xl border border-[color:var(--border)] bg-[color:var(--bg)] shadow-xl">{tool}</div>
      </section>
      {after}
    </div>
  );
}
