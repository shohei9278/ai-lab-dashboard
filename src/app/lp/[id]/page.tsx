import Link from "next/link";
import { notFound } from "next/navigation";
import { getProject, lpCandidates } from "@/lib/loop";
import { hasUnpublishedVersion, versionLabel, versionList, versionLp } from "@/lib/versions";
import { normalizeLp } from "../../../../lp-site/src/lp/content";
import { PreviewBody } from "./Preview";

export const dynamic = "force-dynamic";

// AIが作ったLP・ツールのプレビュー。公開用LPサイトと同じ部品で表示する
// ?v=版の番号 でその版を、?c=候補の番号 で3社が作った候補を表示する（指定がなければ最新の版）
export default async function LpPreview({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ c?: string; w?: string; v?: string }> }) {
  const { id } = await params;
  const { c, w, v } = await searchParams;
  const p = getProject(Number(id));
  if (!p?.lp) notFound();
  const cand = c ? lpCandidates(p.id).find((x) => x.id === Number(c)) : undefined;
  if (c && !cand) notFound();
  const version = v ? Number(v) : p.lp_version;
  const lp = cand ? normalizeLp(JSON.parse(cand.lp)) : versionLp(p, version);
  if (!lp) notFound();
  const pc = w === "pc";
  const query = (extra: Record<string, string | number | undefined>) => {
    const q = new URLSearchParams();
    for (const [k, val] of Object.entries({ v: v ? version : undefined, c, w: pc ? "pc" : undefined, ...extra })) if (val !== undefined && val !== "") q.set(k, String(val));
    const s = q.toString();
    return `/lp/${p.id}${s ? `?${s}` : ""}`;
  };
  const versions = cand ? [] : versionList(p.id);
  return (
    <div className="space-y-4">
      <div className="card space-y-2 p-3 text-sm text-ink-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span>
            {cand ? <b className="mr-1">候補{cand.label}（平均 {cand.avg_score?.toFixed(1) ?? "—"}点）</b> : <b className="mr-1 text-ink">{versionLabel(p, version)}</b>}
            {lp.page ? "公開したときと同じページです（AIが自由にデザイン）。登録フォームはここでは送信されません。" : lp.tool ? "公開したときと同じ見た目です。ツールはここで実際に動きます（シェアのボタンは動きません）。" : "公開したときと同じ見た目です。登録ボタンはここでは動きません。"}
          </span>
          <span className="flex flex-wrap gap-3">
            {lp.page && <Link href={query({ w: pc ? undefined : "pc" })} className="text-accent underline">{pc ? "スマホの幅で見る" : "PCの幅で見る"}</Link>}
            {!cand && hasUnpublishedVersion(p) && <Link href={`/lp/${p.id}/compare`} className="text-accent underline">公開中の版と見比べる</Link>}
            <Link href={`/projects/${p.id}`} className="text-accent underline">案件に戻る</Link>
          </span>
        </div>
        {versions.length > 1 && (
          <nav className="flex flex-wrap gap-2" aria-label="版を選ぶ">
            {versions.map((x) => (
              <Link key={x} href={query({ v: x })} aria-current={x === version ? "true" : undefined} className={`num rounded-full border px-3 py-0.5 text-xs ${x === version ? "border-accent bg-accent text-accent-ink" : "border-line"}`}>
                {versionLabel(p, x)}
              </Link>
            ))}
          </nav>
        )}
      </div>
      <PreviewBody lp={lp} title={p.title} pc={pc} freePage={!cand} />
    </div>
  );
}
