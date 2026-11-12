import type { Lp } from "@/lp/content";

// AIが自由に書いたページ（枠の中）の、枠の外に置く概要。枠の中の文章は検索エンジンから読まれにくいため、
// 同じページに書かれている見出し・特徴・よくある質問を、ふつうの文章として載せる（画面にも出す。隠さない）
export function PageSummary({ title, lp }: { title: string; lp: Lp }) {
  return (
    <section aria-labelledby="page-summary" className="border-t border-line bg-surface-2 px-4 py-12">
      <div className="mx-auto max-w-3xl">
        <p className="text-xs font-bold text-ink-2">このページの概要</p>
        <h1 id="page-summary" className="mt-1 text-xl font-bold">{title}</h1>
        <p className="mt-2 text-ink-2">{lp.headline}</p>
        {lp.subheadline && <p className="mt-2 text-sm text-ink-2">{lp.subheadline}</p>}
        {lp.features.length > 0 && (
          <ul className="mt-4 list-disc space-y-1 pl-5 text-sm">
            {lp.features.map((f) => (
              <li key={f.title}>
                <strong>{f.title}</strong>
                {f.body && `：${f.body}`}
              </li>
            ))}
          </ul>
        )}
        {lp.faq.length > 0 && (
          <dl className="mt-6 space-y-3 text-sm">
            {lp.faq.map((f) => (
              <div key={f.q}>
                <dt className="font-bold">{f.q}</dt>
                <dd className="mt-1 text-ink-2">{f.a}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </section>
  );
}
