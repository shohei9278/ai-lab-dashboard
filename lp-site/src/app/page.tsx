import type { Metadata } from "next";
import { listPages } from "@/lib/supabase";
import { PageGrid } from "./PageGrid";
import { ToolList } from "./ToolList";
import { SITE_NAME } from "@/lib/site";

// 公開中のツールと事前登録のページの一覧。公開・撤退はデータから自動で反映する（5分ごとに読み直す）
export const revalidate = 300;

export const metadata: Metadata = {
  title: `${SITE_NAME}｜登録なしで使える小さなWebツール`,
  description: "登録なしで使える小さなWebツールと、事前登録を受け付けているサービスの一覧です。",
  alternates: { canonical: "/" },
};

export default async function Home() {
  const { tools, lps } = await listPages();
  return (
    <main className="mx-auto max-w-4xl px-4 py-12">
      <h1 className="text-2xl font-bold">{SITE_NAME}</h1>
      {/* ツールを使いに来る人向けのページなので、作り方（AIが作っていること）や実験の記録（ダッシュボードの概要ページ）へのリンクは出さない。
          作り方を見たい人は、ポートフォリオのサイトや概要ページから来る */}
      <p className="mt-2 text-ink-2">遊べるものから、ちょっとした手間を減らす道具まで。登録なしですぐ使える、小さなWebツールです。</p>
      <section className="mt-8">
        <h2 className="text-lg font-bold">すぐ使えるツール</h2>
        <p className="mt-1 text-sm text-ink-2">登録なしで使えます。</p>
        {tools.length ? <ToolList tools={tools} /> : <p className="mt-4 text-ink-2">今はご案内できるツールがありません。</p>}
      </section>
      {lps.length > 0 && (
        <section className="mt-12">
          <h2 className="text-lg font-bold">事前登録を受付中</h2>
          <p className="mt-1 text-sm text-ink-2">まだ完成していないサービスです。使ってみたい方は事前登録ができます。</p>
          <PageGrid pages={lps} />
        </section>
      )}
    </main>
  );
}
