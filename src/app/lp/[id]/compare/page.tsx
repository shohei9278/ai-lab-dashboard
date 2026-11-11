import Link from "next/link";
import { notFound } from "next/navigation";
import { getProject } from "@/lib/loop";
import { versionLabel, versionList, versionLp } from "@/lib/versions";
import { PreviewBody } from "../Preview";

export const dynamic = "force-dynamic";

// 2つの版を並べて見比べる（PCでは左右、スマホでは上下）。指定がなければ、公開中の版と最新の版
export default async function ComparePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ a?: string; b?: string }> }) {
  const { id } = await params;
  const q = await searchParams;
  const p = getProject(Number(id));
  if (!p?.lp) notFound();
  const versions = versionList(p.id);
  const pick = (raw: string | undefined, fallback: number) => (raw && versions.includes(Number(raw)) ? Number(raw) : fallback);
  const b = pick(q.b, p.lp_version);
  const a = pick(q.a, p.public_version !== null && p.public_version !== b ? p.public_version : versions.find((v) => v < b) ?? b);
  const sides = [a, b].map((v) => ({ v, lp: versionLp(p, v) }));
  const href = (side: "a" | "b", v: number) => `/lp/${p.id}/compare?a=${side === "a" ? v : a}&b=${side === "b" ? v : b}`;
  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-center justify-between gap-2 p-3 text-sm text-ink-2">
        <span>2つの版を並べて見比べます。どちらも公開したときと同じ見た目で、ツールは実際に動きます。</span>
        <Link href={`/projects/${p.id}`} className="text-accent underline">案件に戻る</Link>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {sides.map(({ v, lp }, i) => (
          <section key={i} className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-bold">{i === 0 ? "左" : "右"}: {versionLabel(p, v)}</span>
              <nav className="flex flex-wrap gap-1" aria-label={`${i === 0 ? "左" : "右"}の版を選ぶ`}>
                {versions.map((x) => (
                  <Link key={x} href={href(i === 0 ? "a" : "b", x)} aria-current={x === v ? "true" : undefined} className={`num rounded-full border px-2 py-0.5 text-xs ${x === v ? "border-accent bg-accent text-accent-ink" : "border-line"}`}>第{x}版</Link>
                ))}
              </nav>
              <Link href={`/lp/${p.id}?v=${v}`} target="_blank" className="ml-auto text-xs text-accent underline">この版だけ開く ↗</Link>
            </div>
            {lp ? <PreviewBody lp={lp} title={p.title} /> : <p className="card p-4 text-sm text-ink-2">この版の中身が見つかりません。</p>}
          </section>
        ))}
      </div>
    </div>
  );
}
