import { notFound } from "next/navigation";
import { getSettings } from "@/lib/db";
import { runStats } from "@/lib/stats";
import { AUTHOR_LABEL, ms, pct, yen } from "@/lib/format";
import { LANG_LABEL, TASK_LABEL, VARIANT_LABEL, type PromptLang, type PromptVariant, type TaskType } from "@/lib/tasks";
import type { Provider } from "@/lib/models";
import { MockBadge, StatusBadge, Warnings } from "@/components/ui";
import { AccuracyChart, ConsistencyChart, CostChart, Legend } from "./Charts";
import { AutoRefresh } from "./AutoRefresh";

export const dynamic = "force-dynamic";

// 正解率のヒートマップ用（青の単色ランプ、濃いほど高い）
const RAMP = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95"];
const cell = (rate: number) => {
  const i = Math.min(RAMP.length - 1, Math.floor(rate * RAMP.length));
  return { background: RAMP[i], color: i >= 3 ? "#ffffff" : "#0b0b0b" };
};

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const stats = runStats(Number(id));
  if (!stats) notFound();
  const { run, models, byAuthor, perItem, warnings } = stats;
  const { usdJpy } = getSettings();
  const active = run.status === "running" || run.status === "queued";
  const providers = [...new Set(models.map((m) => m.provider))] as Provider[];
  const progress = run.total_calls ? run.done_calls / run.total_calls : 0;
  const isExtraction = run.task === "extraction";
  // 全回APIエラーで結果がないモデルはグラフから外す（表には残す）
  const charted = models.filter((m) => m.calls > 0);

  return (
    <div className="space-y-6">
      <AutoRefresh active={active} />
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-bold">実行 #{run.id}　{TASK_LABEL[run.task as TaskType]}</h1>
          <MockBadge mock={!!run.mock} />
          <StatusBadge status={run.status} />
        </div>
        <div className="num text-sm text-ink-2">
          プロンプト: {VARIANT_LABEL[run.variant as PromptVariant]}・指示: {LANG_LABEL[run.lang as PromptLang]}・繰り返し {run.reps}回・
          {run.created_at} 開始{run.note && `・メモ: ${run.note}`}
        </div>
        {run.error && <p className="text-sm" style={{ color: "var(--critical)" }}>! {run.error}</p>}
        {active && (
          <div className="card p-3">
            <div className="num mb-1 text-xs text-ink-2">{run.done_calls} / {run.total_calls} 回</div>
            <div className="h-2 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full bg-accent" style={{ width: `${progress * 100}%` }} />
            </div>
          </div>
        )}
      </div>

      <Warnings items={warnings} />

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card space-y-3 p-4">
          <div>
            <h2 className="font-bold">正答率</h2>
            <p className="text-xs text-muted">線は95%信頼区間。区間が重なっている場合、差は誤差の可能性があります。</p>
          </div>
          <Legend providers={providers} />
          <AccuracyChart models={charted} />
        </section>
        <section className="card space-y-3 p-4">
          <div>
            <h2 className="font-bold">一致率（ブレの少なさ）</h2>
            <p className="text-xs text-muted">同じ問題を繰り返したとき、最も多かった回答と一致した割合。</p>
          </div>
          <Legend providers={providers} />
          <ConsistencyChart models={charted} />
        </section>
      </div>

      <section className="card space-y-3 p-4">
        <div>
          <h2 className="font-bold">コスパ</h2>
          <p className="text-xs text-muted">左上ほど「安くて正確」。{run.mock ? "ダミー実行のため費用は見積もり単価で計算しています。" : ""}</p>
        </div>
        <Legend providers={providers} />
        <CostChart models={charted} usdJpy={usdJpy} />
      </section>

      <section className="space-y-2">
        <h2 className="font-bold">モデル別の詳細</h2>
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted">
              <tr className="border-b border-line">
                <th className="px-3 py-2">モデル</th>
                <th className="px-3 py-2 text-right">正答率</th>
                <th className="px-3 py-2 text-right">95%区間</th>
                {isExtraction && <th className="px-3 py-2 text-right">項目単位</th>}
                <th className="px-3 py-2 text-right">一致率</th>
                <th className="px-3 py-2 text-right">形式OK</th>
                <th className="px-3 py-2 text-right">回答拒否</th>
                <th className="px-3 py-2 text-right">APIエラー</th>
                <th className="px-3 py-2 text-right">平均応答</th>
                <th className="px-3 py-2 text-right">1回あたり</th>
                <th className="px-3 py-2 text-right">正解1件あたり</th>
                <th className="px-3 py-2 text-right">合計</th>
              </tr>
            </thead>
            <tbody>
              {models.map((m) => (
                <tr key={m.modelId} className="num border-b border-line last:border-0">
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span className="mr-2 inline-block h-2.5 w-2.5 rounded-full" style={{ background: `var(--series-${m.provider})` }} />
                    {m.label}
                  </td>
                  <td className="px-3 py-2 text-right">{pct(m.accuracy)}</td>
                  <td className="px-3 py-2 text-right text-ink-2">{pct(m.ci[0])}〜{pct(m.ci[1])}</td>
                  {isExtraction && <td className="px-3 py-2 text-right">{pct(m.fieldScore)}</td>}
                  <td className="px-3 py-2 text-right">{m.consistency === null ? "—" : pct(m.consistency)}</td>
                  <td className="px-3 py-2 text-right">{pct(m.formatRate)}</td>
                  <td className="px-3 py-2 text-right">{pct(m.refusalRate)}</td>
                  <td className="px-3 py-2 text-right">{m.apiErrors || "—"}</td>
                  <td className="px-3 py-2 text-right">{ms(m.avgLatencyMs)}</td>
                  <td className="px-3 py-2 text-right">{yen(m.costPerCallUsd, usdJpy)}</td>
                  <td className="px-3 py-2 text-right">{m.costPerCorrectUsd === null ? "—" : yen(m.costPerCorrectUsd, usdJpy)}</td>
                  <td className="px-3 py-2 text-right">{yen(m.costUsd, usdJpy)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="font-bold">問題の作成者別の正答率</h2>
        <p className="text-xs text-muted">作成したAIの問題で、そのAIだけ正答率が高ければ「作成者の偏り」の可能性があります。</p>
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted">
              <tr className="border-b border-line">
                <th className="px-3 py-2">作成者</th>
                <th className="px-3 py-2 text-right">問題数</th>
                {models.map((m) => <th key={m.modelId} className="px-3 py-2 text-right whitespace-nowrap">{m.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {byAuthor.map((a) => (
                <tr key={a.author} className="num border-b border-line last:border-0">
                  <td className="px-3 py-2">{AUTHOR_LABEL[a.author] ?? a.author}</td>
                  <td className="px-3 py-2 text-right">{a.items}</td>
                  {models.map((m) => <td key={m.modelId} className="px-3 py-2 text-right">{pct(a.accuracy[m.modelId] ?? 0)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="font-bold">問題ごとの正解率</h2>
        <p className="text-xs text-muted">色が濃いほど正解率が高い。全モデルが苦手な問題は、問題自体の見直し候補です。</p>
        <div className="card overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-muted">
              <tr className="border-b border-line">
                <th className="px-2 py-2">問題</th>
                {models.map((m) => <th key={m.modelId} className="px-2 py-2 text-center whitespace-nowrap">{m.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {perItem.map((it) => (
                <tr key={it.itemId}>
                  <td className="px-2 py-1 text-ink-2">{it.itemId}</td>
                  {models.map((m) => {
                    const r = it.rates[m.modelId] ?? 0;
                    return (
                      <td key={m.modelId} className="p-0.5">
                        <div className="num rounded px-2 py-1 text-center" style={cell(r)} title={`${it.itemId} / ${m.label}: ${pct(r)}`}>
                          {pct(r)}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
