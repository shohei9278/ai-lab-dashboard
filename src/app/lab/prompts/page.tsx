import { getSettings } from "@/lib/db";
import { isOwner } from "@/lib/viewer";
import { jstDateTime, yen } from "@/lib/format";
import { modelInfo } from "@/lib/models";
import { FACTORS, estimateJpy, factorSummary, listPromptTests, runningTest, testableProjects, type Factor, type PromptTest, type Side } from "@/lib/promptCompare";
import { PageIntro } from "@/components/PageIntro";
import { LabTabs } from "@/components/LabTabs";
import { ShowMore } from "@/components/ShowMore";
import { AutoRefresh } from "../../runs/[id]/AutoRefresh";
import { PromptTestForm } from "./PromptTestForm";

export const dynamic = "force-dynamic";

const shot = (file: string) => `/api/screenshots/${encodeURIComponent(file)}`;

function SideView({ title, side, score, win }: { title: string; side: Side | null; score: number | null; win: boolean }) {
  return (
    <div className="min-w-0 space-y-2">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium">{title}</span>
        {score !== null && <span className="num font-bold" style={{ color: win ? "var(--good)" : undefined }}>{score.toFixed(1)}点{win ? "（勝ち）" : ""}</span>}
      </div>
      {side?.shots.length ? (
        <details>
          <summary className="cursor-pointer list-none">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={shot(side.shots[0])} alt={`${title}の最初の画面`} loading="lazy" className="w-full rounded-lg border border-line" />
            <span className="mt-1 block text-xs text-accent underline">ほかの画面も見る（{side.shots.length + (side.pc ? 1 : 0)}枚）</span>
          </summary>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {[...side.shots.slice(1), ...(side.pc ? [side.pc] : [])].map((f) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={f} src={shot(f)} alt="" loading="lazy" className="w-full rounded border border-line" />
            ))}
          </div>
        </details>
      ) : (
        <p className="text-xs text-muted">画面はありません</p>
      )}
      {side && side.issues.length > 0 && <p className="text-xs" style={{ color: "var(--warning)" }}>決まりの指摘: {side.issues.join(" / ")}</p>}
      {side && <p className="num text-xs text-muted">{(side.chars / 1000).toFixed(1)}千文字</p>}
    </div>
  );
}

function TestCard({ t, usdJpy }: { t: PromptTest; usdJpy: number }) {
  const f = FACTORS[t.factor as Factor];
  const aWin = t.score_a !== null && t.score_b !== null && t.score_a > t.score_b;
  const bWin = t.score_a !== null && t.score_b !== null && t.score_b > t.score_a;
  return (
    <article className="card space-y-3 p-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="rounded bg-surface-2 px-1.5 text-xs">{f?.label ?? t.factor}</span>
        <h3 className="font-bold">#{t.project_id} {t.title}</h3>
        <span className="num ml-auto text-xs text-muted">
          {jstDateTime(t.at)} ・{modelInfo(t.model_id).label}{t.cost_usd !== null ? ` ・${yen(t.cost_usd, usdJpy)}` : ""}
        </span>
      </div>
      {t.status === "running" && <p className="text-sm text-ink-2">LPを2つ作って、3社が採点しています（5〜10分ほど）…</p>}
      {t.status === "error" && <p className="text-sm" style={{ color: "var(--critical)" }}>失敗しました: {t.error}</p>}
      {t.status === "done" && (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <SideView title={`今の渡し方（${f?.a ?? "a"}）`} side={t.a} score={t.score_a} win={aWin} />
            <SideView title={`変えた渡し方（${f?.b ?? "b"}）`} side={t.b} score={t.score_b} win={bWin} />
          </div>
          {t.judges.length > 0 && (
            <ul className="space-y-1 border-t border-line pt-2 text-sm">
              {t.judges.map((j) => (
                <li key={j.modelId}>
                  <span style={{ color: `var(--series-${modelInfo(j.modelId).provider})` }}>{modelInfo(j.modelId).label}</span>
                  <span className="num text-xs text-muted">（今 {j.a}点・変えた {j.b}点）</span>
                  <span className="text-ink-2"> {j.reason}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </article>
  );
}

export default async function PromptTestsPage() {
  const s = getSettings();
  const owner = await isOwner();
  const running = runningTest();
  const tests = listPromptTests();
  const summary = factorSummary();
  const factors = (Object.keys(FACTORS) as Factor[]).map((key) => ({ key, ...FACTORS[key], estimate: estimateJpy(key) }));

  return (
    <div className="space-y-6">
      <AutoRefresh active={!!running} />
      <PageIntro title="プロンプトの比較">
        AIへの指示の渡し方を1か所だけ変えると、作るLPの質が変わるかを確かめます。同じ案件・同じAI（Claude）で、今の渡し方と変えた渡し方のLPを1つずつ作り、
        Claude・GPT・Gemini の3社が、どちらがどの渡し方か伏せたまま、画面を見て1〜10点で採点します。作ったLPは案件には使いません。
      </PageIntro>
      <LabTabs current="/lab/prompts" />

      <section className="space-y-2">
        <h2 className="font-bold">項目ごとの結果</h2>
        <div className="card overflow-x-auto">
          <table className="m-scroll w-full text-sm">
            <thead className="text-left text-xs text-muted">
              <tr>
                <th className="px-3 py-2">変える所</th>
                <th className="px-3 py-2">今の渡し方 → 変えた渡し方</th>
                <th className="px-3 py-2 text-right">回数</th>
                <th className="px-3 py-2 text-right">変えた方の勝ち</th>
                <th className="px-3 py-2 text-right">点の差の平均</th>
              </tr>
            </thead>
            <tbody>
              {summary.map((r) => (
                <tr key={r.factor} className="border-t border-line">
                  <td className="whitespace-nowrap px-3 py-2 font-medium">{FACTORS[r.factor].label}</td>
                  <td className="min-w-48 px-3 py-2 text-ink-2">{FACTORS[r.factor].a} → {FACTORS[r.factor].b}</td>
                  <td className="num px-3 py-2 text-right">{r.n}</td>
                  <td className="num whitespace-nowrap px-3 py-2 text-right">{r.n ? `${r.bWins}勝${r.n - r.bWins - r.ties}敗${r.ties ? `${r.ties}分` : ""}` : "—"}</td>
                  <td className="num whitespace-nowrap px-3 py-2 text-right">{r.diff === null ? "—" : `${r.diff > 0 ? "+" : ""}${r.diff.toFixed(1)}点`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted">点の差は「変えた渡し方 − 今の渡し方」。AIの採点はぶれるので、1〜2回の差では決めず、同じ項目を5回以上くり返してから読みます。</p>
      </section>

      {owner && (
        <section className="card space-y-3 p-4">
          <h2 className="font-bold">比べる</h2>
          {running ? (
            <p className="text-sm">いま比較が動いています（#{running.project_id}・{FACTORS[running.factor as Factor]?.label ?? running.factor}）。終わってから次を実行できます。</p>
          ) : (
            <PromptTestForm projects={testableProjects()} factors={factors} />
          )}
        </section>
      )}

      <section className="space-y-3">
        <h2 className="font-bold">これまでの比較</h2>
        {tests.length ? (
          <ShowMore initial={10} className="space-y-3">{tests.map((t) => <TestCard key={t.id} t={t} usdJpy={s.usdJpy} />)}</ShowMore>
        ) : (
          <p className="text-sm text-ink-2">まだ比較していません。</p>
        )}
      </section>
    </div>
  );
}
