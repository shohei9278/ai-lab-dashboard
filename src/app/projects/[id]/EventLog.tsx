import Link from "next/link";
import type { EventRow } from "@/lib/db";
import { decisionShort, type EventDetail } from "@/lib/eventDetails";
import { KIND_LABEL } from "@/lib/loop";
import { modelInfo } from "@/lib/models";
import { jstDateTime } from "@/lib/format";

const ACTOR = { ai: "AI", human: "あなた", system: "システム" } as const;
const pt = (x: number | null) => (x === null ? "—" : `${x.toFixed(1)}点`);

// 案件の経過。中身がある行（候補の選定・判断・議論）は、押すと開く
export function EventLog({ projectId, events, details }: { projectId: number; events: EventRow[]; details: Map<number, EventDetail> }) {
  return (
    <ol className="card divide-y divide-line text-sm">
      {events.map((e) => {
        const d = details.get(e.id);
        const head = (
          <>
            <span className="num shrink-0 text-xs text-muted">{jstDateTime(e.at)}</span>
            <span className="w-14 shrink-0 text-xs font-medium" style={{ color: e.actor === "ai" ? "var(--accent)" : "var(--text-2)" }}>{ACTOR[e.actor]}</span>
            <span className="min-w-0 flex-1">{e.message}</span>
          </>
        );
        if (!d) return <li key={e.id} className="flex gap-3 p-3">{head}</li>;
        return (
          <li key={e.id}>
            <details className="group">
              <summary className="flex cursor-pointer list-none gap-3 p-3 hover:bg-surface-2">
                {head}
                <span className="shrink-0 text-xs text-accent"><span className="group-open:hidden">中身を見る ▾</span><span className="hidden group-open:inline">閉じる ▴</span></span>
              </summary>
              <div className="border-t border-line bg-surface-2 p-3">
                <Detail projectId={projectId} d={d} />
              </div>
            </details>
          </li>
        );
      })}
    </ol>
  );
}

function Scores({ scores }: { scores: { scorer: string; score: number; reason: string | null }[] }) {
  if (!scores.length) return null;
  return (
    <ul className="mt-2 space-y-1 text-xs">
      {scores.map((s, i) => (
        <li key={i} className="flex gap-2">
          <span className="num w-12 shrink-0 font-medium">{s.score.toFixed(0)}点</span>
          <span className="w-36 shrink-0 text-ink-2">{s.scorer}</span>
          <span className="text-ink-2">{s.reason ?? ""}</span>
        </li>
      ))}
    </ul>
  );
}

function Detail({ projectId, d }: { projectId: number; d: EventDetail }) {
  if (d.type === "ideas") {
    return (
      <div className="space-y-2">
        <p className="text-xs text-muted">同じ回に3社が出したアイデアの候補です。点数は、作者を伏せて3社が付けたものです（平均の高い順）。</p>
        {d.candidates.map((c) => (
          <div key={c.label} className="rounded-lg border bg-surface p-3" style={{ borderColor: c.isThis ? "var(--accent)" : "var(--border)" }}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-medium">
                {c.label}. {c.title}
                {c.isThis && <span className="ml-2 text-xs text-accent">← この案件</span>}
                {c.selected && !c.isThis && <span className="ml-2 text-xs text-ink-2">（別の案件として採用）</span>}
              </span>
              <span className="num text-sm font-bold">{pt(c.avg)}</span>
            </div>
            <div className="text-xs text-ink-2">
              {c.kind ? KIND_LABEL[c.kind === "tool" ? "tool" : "lp"] : ""}{c.author ? `・${c.author}の案` : "・作者は最初の承認まで伏せています"}
            </div>
            {c.target && <p className="mt-1 text-xs"><span className="text-muted">対象:</span> {c.target}</p>}
            {c.solution && <p className="text-xs"><span className="text-muted">中身:</span> {c.solution}</p>}
            {c.channel && <p className="text-xs"><span className="text-muted">最初の届け方:</span> {c.channel}</p>}
            {c.reason && <p className="text-xs"><span className="text-muted">作者の狙い:</span> {c.reason}</p>}
            <Scores scores={c.scores} />
          </div>
        ))}
      </div>
    );
  }
  if (d.type === "lp") {
    return (
      <div className="space-y-2">
        <p className="text-xs text-muted">3社が作ったLPの候補です。点数は、作者を伏せて3社が付けたものです。候補を押すと、その見た目を開けます。</p>
        {d.candidates.map((c) => (
          <div key={c.id} className="rounded-lg border bg-surface p-3" style={{ borderColor: c.selected || c.humanSelected ? "var(--accent)" : "var(--border)" }}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <Link href={`/lp/${projectId}?c=${c.id}`} target="_blank" className="font-medium text-accent underline">候補{c.label}: {c.headline} ↗</Link>
              <span className="num text-sm font-bold">{pt(c.avg)}</span>
            </div>
            <div className="text-xs text-ink-2">
              {c.author}が作成{c.selected ? "・AIが選択" : ""}{c.humanSelected ? "・あなたが選択" : ""}
            </div>
            <Scores scores={c.scores} />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div>
        <p className="mb-1 text-xs text-muted">同じ数字を各AIに見せたときの判断です。実際に使ったのは「担当」のAIの判断です。</p>
        <ul className="space-y-2">
          {d.rows.map((r, i) => (
            <li key={i} className="rounded-lg border border-line bg-surface p-3 text-xs">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-sm font-medium">{decisionShort(r.decision)}</span>
                <span className="text-ink-2">{r.model}{r.isPrimary ? "（担当）" : ""}</span>
                {r.confidence !== null && <span className="num text-muted">自信 {Math.round(r.confidence * 100)}%</span>}
              </div>
              {r.error ? <p style={{ color: "var(--critical)" }}>失敗: {r.error}</p> : <p className="mt-1 text-ink-2">{r.reason}</p>}
              {r.nextAction && <p className="mt-1"><span className="text-muted">次にやること:</span> {r.nextAction}</p>}
            </li>
          ))}
        </ul>
      </div>
      {d.debate && (
        <div>
          <p className="mb-1 text-xs font-medium">AI同士の議論（判断が割れたため、1回ずつ反論させたもの）</p>
          <p className="text-xs"><span className="text-muted">争点:</span> {d.debate.issue}</p>
          {d.debate.missing_info && <p className="text-xs"><span className="text-muted">足りない情報:</span> {d.debate.missing_info}</p>}
          <ul className="mt-2 space-y-2">
            {d.debate.positions.map((x) => (
              <li key={x.modelId} className="rounded-lg border border-line bg-surface p-3 text-xs">
                <div className="flex flex-wrap gap-2">
                  <span className="font-medium">{modelInfo(x.modelId).label}</span>
                  <span className="text-ink-2">{decisionShort(x.first)}{x.changed ? ` → ${decisionShort(x.final)}（考えを変えた）` : "（変えず）"}</span>
                </div>
                <p className="mt-1 text-ink-2">{x.argument}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
