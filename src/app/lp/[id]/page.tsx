import Link from "next/link";
import { notFound } from "next/navigation";
import { getProject, type Lp } from "@/lib/loop";

export const dynamic = "force-dynamic";

// AIが作ったLPのプレビュー。実際の公開先に載せる前の確認用
export default async function LpPreview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = getProject(Number(id));
  if (!p?.lp) notFound();
  const lp = JSON.parse(p.lp) as Lp;

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-center justify-between gap-2 p-3 text-sm text-ink-2">
        <span>プレビュー: AIが作ったLPです。登録ボタンはまだ動きません。</span>
        <Link href={`/projects/${p.id}`} className="text-accent underline">案件に戻る</Link>
      </div>

      <article className="mx-auto max-w-3xl overflow-hidden rounded-2xl border border-line bg-surface">
        <header className="space-y-4 px-6 py-12 text-center sm:px-12">
          <div className="text-sm text-muted">{p.title}</div>
          <h1 className="text-2xl font-bold leading-snug sm:text-3xl">{lp.headline}</h1>
          <p className="text-ink-2">{lp.subheadline}</p>
          <button type="button" disabled className="rounded-full bg-accent px-6 py-3 font-medium text-accent-ink">{lp.cta}</button>
        </header>

        <section className="space-y-3 bg-surface-2 px-6 py-10 sm:px-12">
          <h2 className="text-center font-bold">こんなことで困っていませんか？</h2>
          <ul className="mx-auto max-w-xl space-y-2">
            {lp.pains.map((x) => (
              <li key={x} className="flex gap-2"><span aria-hidden className="text-muted">□</span>{x}</li>
            ))}
          </ul>
        </section>

        <section className="grid gap-4 px-6 py-10 sm:grid-cols-3 sm:px-12">
          {lp.features.map((f) => (
            <div key={f.title} className="space-y-1">
              <h3 className="font-bold">{f.title}</h3>
              <p className="text-sm text-ink-2">{f.body}</p>
            </div>
          ))}
        </section>

        <section className="space-y-3 border-t border-line px-6 py-10 sm:px-12">
          <h2 className="font-bold">よくある質問</h2>
          {lp.faq.map((f) => (
            <div key={f.q}>
              <div className="font-medium">Q. {f.q}</div>
              <div className="text-sm text-ink-2">A. {f.a}</div>
            </div>
          ))}
        </section>

        <footer className="px-6 py-10 text-center sm:px-12">
          <button type="button" disabled className="rounded-full bg-accent px-6 py-3 font-medium text-accent-ink">{lp.cta}</button>
        </footer>
      </article>
    </div>
  );
}
