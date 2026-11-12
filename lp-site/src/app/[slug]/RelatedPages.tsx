import Link from "next/link";
import { listPages } from "@/lib/supabase";

// ページの下の「ほかのツール」。1ページだけ見て帰らず、ほかのページにも進めるようにする
// すぐ使えるツールを先に出す。s=related は「サイトの中から来た」の目印（ダッシュボードで分けて数える）
export async function RelatedPages({ slug, limit = 3 }: { slug: string; limit?: number }) {
  const { tools, lps } = await listPages().catch(() => ({ tools: [], lps: [] }));
  const items = [...tools, ...lps].filter((p) => p.slug !== slug).slice(0, limit);
  return (
    <nav aria-label="ほかのページ" className="border-t border-line px-4 py-12">
      <div className="mx-auto max-w-4xl">
        {items.length > 0 && (
          <>
            <h2 className="text-lg font-bold">ほかにもこんなツールがあります</h2>
            <ul className="mt-4 grid gap-4 sm:grid-cols-3">
              {items.map((t) => (
                <li key={t.slug}>
                  <Link href={`/${t.slug}?s=related`} className="block overflow-hidden rounded-xl border border-black/10 transition hover:border-black/30">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/${t.slug}/opengraph-image?v=${t.version}`} alt="" loading="lazy" className="aspect-[1200/630] w-full object-cover" />
                    <div className="p-3">
                      <h3 className="text-sm font-bold">{t.title}</h3>
                      {t.sub && <p className="mt-1 line-clamp-2 text-xs text-ink-2">{t.sub}</p>}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
        <p className="mt-6 text-center text-sm">
          <Link href="/?s=related" className="underline">すべてのツールを見る</Link>
        </p>
      </div>
    </nav>
  );
}
