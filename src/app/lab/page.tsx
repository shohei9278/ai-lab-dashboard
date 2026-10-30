import Link from "next/link";
import { db, getSettings, monthSpendBreakdownUsd, type RunRow } from "@/lib/db";
import { MODELS, PROVIDER_ENV, PROVIDER_LABEL, getModel, hasKey, type Provider } from "@/lib/models";
import { runStats } from "@/lib/stats";
import { pct, yen } from "@/lib/format";
import { TASK_LABEL, type TaskType } from "@/lib/tasks";
import { RunsTable } from "@/components/RunsTable";
import { PageIntro } from "@/components/PageIntro";
import { ShadowJudgments } from "@/components/ShadowJudgments";
import { IdeaAuthors } from "@/components/IdeaAuthors";
import { MockBadge, Stat } from "@/components/ui";

export const dynamic = "force-dynamic";

export default function LabPage() {
  const s = getSettings();
  const spend = monthSpendBreakdownUsd();
  const runs = db().prepare("SELECT * FROM runs ORDER BY id DESC LIMIT 5").all() as RunRow[];
  const counts = db().prepare("SELECT COUNT(*) AS n, SUM(status = 'running') AS running FROM runs").get() as { n: number; running: number | null };
  const latest = db().prepare("SELECT id FROM runs WHERE status = 'done' ORDER BY id DESC LIMIT 1").get() as { id: number } | undefined;
  const stats = latest ? runStats(latest.id) : null;
  const providers = [...new Set(MODELS.map((m) => m.provider))] as Provider[];

  return (
    <div className="space-y-6">
      <PageIntro
        title="AIの使い分け"
        actions={
          <>
            <Link href="/datasets" className="rounded-lg border border-line px-3 py-2 text-sm">問題データ</Link>
            <Link href="/runs/new" className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-ink">テストを実行</Link>
          </>
        }
      >
        プロダクトを作る各工程を、どのAIに任せるのが良いかを決めるためのページです。
        実際の案件の判断を裏で他のAIにも行わせた比較と、答えが決まった問題での基礎テストの2つがあります。
        いま製品ループで使っているAIは <b>{getModel(s.loopModel).label}</b> です（設定で変更できます）。
      </PageIntro>

      <ShadowJudgments />

      <IdeaAuthors />

      <div className="space-y-1 border-t border-line pt-6">
        <h2 className="font-bold">基礎テスト</h2>
        <p className="text-sm text-ink-2">
          製品ループとは別に、答えが決まった問題（問い合わせ分類・請求書抽出）で、AIごとの基本的な正確さ・ブレ・費用を測ります。
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="今月のテスト費用" value={yen(spend.eval, s.usdJpy)} sub="実APIの分のみ" />
        <Stat label="テスト実行数" value={counts.n} sub={counts.running ? `${counts.running}件 実行中` : "実行中なし"} />
        <Stat
          label="APIキー"
          value={`${providers.filter(hasKey).length} / ${providers.length}`}
          sub={providers.map((p) => `${PROVIDER_LABEL[p]} ${hasKey(p) ? "✓" : "—"}`).join("　")}
        />
      </div>

      <section className="space-y-2">
        <div className="flex items-baseline justify-between">
          <h2 className="font-bold">最新の比較結果</h2>
          {stats && <Link href={`/runs/${stats.run.id}`} className="text-sm text-accent underline">詳細を見る</Link>}
        </div>
        {stats ? (
          <div className="card overflow-x-auto">
            <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-sm text-ink-2">
              #{stats.run.id} {TASK_LABEL[stats.run.task as TaskType]} <MockBadge mock={!!stats.run.mock} />
            </div>
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr className="border-b border-line">
                  <th className="px-3 py-2">モデル</th>
                  <th className="px-3 py-2 text-right">正答率</th>
                  <th className="px-3 py-2 text-right">一致率</th>
                  <th className="px-3 py-2 text-right">1回あたり</th>
                </tr>
              </thead>
              <tbody>
                {[...stats.models].sort((a, b) => b.accuracy - a.accuracy).map((m) => (
                  <tr key={m.modelId} className="border-b border-line last:border-0">
                    <td className="px-3 py-2">
                      <span className="mr-2 inline-block h-2.5 w-2.5 rounded-full" style={{ background: `var(--series-${m.provider})` }} />
                      {m.label}
                    </td>
                    <td className="num px-3 py-2 text-right">{m.calls ? pct(m.accuracy) : "結果なし"}</td>
                    <td className="num px-3 py-2 text-right">{m.consistency === null ? "—" : pct(m.consistency)}</td>
                    <td className="num px-3 py-2 text-right">{yen(m.costPerCallUsd, s.usdJpy)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="card p-6 text-sm text-ink-2">完了した実行がまだありません。</div>
        )}
      </section>

      <section className="space-y-2">
        <div className="flex items-baseline justify-between">
          <h2 className="font-bold">最近の実行</h2>
          <Link href="/runs" className="text-sm text-accent underline">すべて見る</Link>
        </div>
        <RunsTable runs={runs} usdJpy={s.usdJpy} />
      </section>

      <p className="text-xs text-muted">
        APIキーは <code>.env.local</code> に {Object.values(PROVIDER_ENV).join(" / ")} として設定します。
      </p>
    </div>
  );
}
