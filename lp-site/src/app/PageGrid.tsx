import Link from "next/link";
import type { ListedPage } from "@/lib/supabase";
import { SITE_CATEGORIES, isSiteCategory } from "@/lp/categories";

// 一覧のカード（ツールと事前登録のページで同じ形）
// showTag: カードの上にカテゴリのタグ（「診断・占い」など）を出す（ツールの一覧だけ。カテゴリがないものには出さない）
export function PageGrid({ pages, showTag = false }: { pages: ListedPage[]; showTag?: boolean }) {
  return (
    <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {pages.map((t) => (
        <li key={t.slug}>
          {/* s=index は「一覧から来た」の目印（ダッシュボードで分けて数える） */}
          <Link href={`/${t.slug}?s=index`} className="block overflow-hidden rounded-xl border border-black/10 transition hover:border-black/30">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/${t.slug}/opengraph-image?v=${t.version}`} alt="" loading="lazy" className="aspect-[1200/630] w-full object-cover" />
            <div className="p-3">
              {showTag && isSiteCategory(t.category) && (
                <span className="mb-1.5 inline-block rounded-full bg-black/5 px-2 py-0.5 text-xs text-ink-2">{SITE_CATEGORIES[t.category].label}</span>
              )}
              <h3 className="font-bold">{t.title}</h3>
              {/* 説明文は途中で切らず、全文を出す（どんなツールかを選ぶ前に読めるように） */}
              {t.sub && <p className="mt-1 text-sm text-ink-2">{t.sub}</p>}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
