import type { Metadata } from "next";
import Link from "next/link";
import { listPages, type ListedPage } from "@/lib/supabase";
import { DASHBOARD_URL, SITE_NAME } from "@/lib/site";

// 公開中のツールと事前登録のページの一覧。公開・撤退はデータから自動で反映する（5分ごとに読み直す）
export const revalidate = 300;

const RECORD_URL = `${DASHBOARD_URL}/showcase`;

export const metadata: Metadata = {
  title: `${SITE_NAME}｜AIが作っている小さなWebツール`,
  description: "AIが企画して作っている、登録なしで使える小さなWebツールと、事前登録を受け付けているサービスの一覧です。",
};

function PageGrid({ pages }: { pages: ListedPage[] }) {
  return (
    <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {pages.map((t) => (
        <li key={t.slug}>
          {/* s=index は「一覧から来た」の目印（ダッシュボードで分けて数える） */}
          <Link href={`/${t.slug}?s=index`} className="block overflow-hidden rounded-xl border border-black/10 transition hover:border-black/30">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/${t.slug}/opengraph-image?v=${t.version}`} alt="" loading="lazy" className="aspect-[1200/630] w-full object-cover" />
            <div className="p-3">
              <h3 className="font-bold">{t.title}</h3>
              {t.sub && <p className="mt-1 line-clamp-2 text-sm text-ink-2">{t.sub}</p>}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default async function Home() {
  const { tools, lps } = await listPages();
  return (
    <main className="mx-auto max-w-4xl px-4 py-12">
      <h1 className="text-2xl font-bold">{SITE_NAME}</h1>
      <p className="mt-2 text-ink-2">AIが企画して作っている、小さなWebツールとサービスです。</p>
      <p className="mt-1 text-sm">
        <a href={RECORD_URL} target="_blank" rel="noreferrer" className="underline">AIを社員にした実験の記録を見る</a>
      </p>
      <section className="mt-8">
        <h2 className="text-lg font-bold">すぐ使えるツール</h2>
        <p className="mt-1 text-sm text-ink-2">登録なしで使えます。</p>
        {tools.length ? <PageGrid pages={tools} /> : <p className="mt-4 text-ink-2">今はご案内できるツールがありません。</p>}
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
