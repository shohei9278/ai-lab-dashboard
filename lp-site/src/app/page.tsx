import type { Metadata } from "next";
import Link from "next/link";
import { listTools } from "@/lib/supabase";
import { SITE_NAME } from "@/lib/site";

// 公開中のツールの一覧。公開・撤退はデータから自動で反映する（5分ごとに読み直す）
export const revalidate = 300;

const RECORD_URL = "https://ai-lab-dashboard-production-fc9e.up.railway.app/showcase";

export const metadata: Metadata = {
  title: `${SITE_NAME}｜AIが作っている小さなWebツール`,
  description: "AIが企画して作っている、登録なしで使える小さなWebツールの一覧です。",
};

export default async function Home() {
  const tools = await listTools();
  return (
    <main className="mx-auto max-w-4xl px-4 py-12">
      <h1 className="text-2xl font-bold">{SITE_NAME}</h1>
      <p className="mt-2 text-ink-2">AIが企画して作っている、登録なしで使える小さなWebツールです。</p>
      <p className="mt-1 text-sm">
        <a href={RECORD_URL} target="_blank" rel="noreferrer" className="underline">AIを社員にした実験の記録を見る</a>
      </p>
      {tools.length ? (
        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tools.map((t) => (
            <li key={t.slug}>
              <Link href={`/${t.slug}`} className="block overflow-hidden rounded-xl border border-black/10 transition hover:border-black/30">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/${t.slug}/opengraph-image?v=${t.version}`} alt="" loading="lazy" className="aspect-[1200/630] w-full object-cover" />
                <div className="p-3">
                  <h2 className="font-bold">{t.title}</h2>
                  {t.sub && <p className="mt-1 line-clamp-2 text-sm text-ink-2">{t.sub}</p>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-8 text-ink-2">今はご案内できるツールがありません。</p>
      )}
    </main>
  );
}
