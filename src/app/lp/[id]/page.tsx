import Link from "next/link";
import { notFound } from "next/navigation";
import { getProject, lpCandidates } from "@/lib/loop";
import { normalizeLp } from "../../../../lp-site/src/lp/content";
import { LpView, lpButtonClass, lpButtonStyle } from "../../../../lp-site/src/lp/LpView";
import { ToolFrame } from "../../../../lp-site/src/lp/ToolFrame";

export const dynamic = "force-dynamic";

// AIが作ったLPのプレビュー。公開用LPサイトと同じ部品で表示する
export default async function LpPreview({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ c?: string }> }) {
  const { id } = await params;
  const { c } = await searchParams;
  const p = getProject(Number(id));
  if (!p?.lp) notFound();
  // ?c=候補の番号 で、3社が作ったLPの候補を表示する
  const cand = c ? lpCandidates(p.id).find((x) => x.id === Number(c)) : undefined;
  if (c && !cand) notFound();
  const lp = normalizeLp(JSON.parse(cand ? cand.lp : p.lp));
  const button = <button type="button" aria-disabled title="プレビューでは押せません" className={`${lpButtonClass} cursor-default`} style={lpButtonStyle}>{lp.cta}</button>;

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-center justify-between gap-2 p-3 text-sm text-ink-2">
        <span>
          {cand && <b className="mr-1">候補{cand.label}（平均 {cand.avg_score?.toFixed(1) ?? "—"}点）</b>}
          {lp.tool
            ? "プレビュー: 公開したときと同じ見た目です。ツールはここで実際に動きます（シェアのボタンは動きません）。公開する前に一通り触って確かめてください。"
            : "プレビュー: 公開したときと同じ見た目です。登録ボタンはここでは動きません。"}
        </span>
        <Link href={`/projects/${p.id}`} className="text-accent underline">案件に戻る</Link>
      </div>
      <article className="overflow-hidden rounded-2xl border border-line bg-[color:var(--bg)]">
        <LpView
          lp={lp}
          title={p.title}
          topCta={lp.tool ? <a href="#tool" className={lpButtonClass} style={lpButtonStyle}>{lp.cta}</a> : button}
          signup={<div className="text-center">{button}</div>}
          tool={lp.tool ? <ToolFrame html={lp.tool.html} title={p.title} /> : undefined}
        />
      </article>
    </div>
  );
}
