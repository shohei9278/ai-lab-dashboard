import Link from "next/link";
import { PageIntro } from "@/components/PageIntro";
import { ShowMore } from "@/components/ShowMore";
import { db, getSettings, type ProjectRow, type Stage } from "@/lib/db";
import { pct } from "@/lib/format";
import { CONV, MODE_LABEL, STAGE_LABEL, ideaAuthors, projectTotals, targetRate } from "@/lib/loop";
import { getModel } from "@/lib/models";
import { IdeaForm } from "@/components/IdeaForm";
import { DailyCard } from "@/components/DailyCard";

export const dynamic = "force-dynamic";

const COLUMNS: { stages: Stage[]; title: string; who: string }[] = [
  { stages: ["idea"], title: "① アイデア", who: "3社のAIが出して採点し、上位を進める" },
  { stages: ["lp"], title: "② 作成", who: "AIがLPやツールを作ってチェック。通れば自動で公開" },
  { stages: ["live"], title: "③ 公開中・集客中", who: "AIがSNSに投稿して人を呼ぶ。届いていなければ集客を見直し、「続ける」になった案件は育てる" },
  { stages: ["deciding"], title: "④ 判断", who: "AIが続ける・改善・集客の見直し・撤退を決める" },
  { stages: ["continued", "killed", "rejected"], title: "⑤ 結果", who: "終わった案件。AIが教訓を残す" },
];

// 案件の一覧: アイデアから結果まで、どの段階にいるかを並べる
export default function ProjectsPage() {
  const s = getSettings();
  const projects = db().prepare("SELECT * FROM projects ORDER BY updated_at DESC").all() as ProjectRow[];
  const pendingByProject = new Set(
    (db().prepare("SELECT DISTINCT project_id FROM approvals WHERE status = 'pending'").all() as { project_id: number }[]).map((r) => r.project_id),
  );
  const lastDaily = db().prepare("SELECT message FROM events WHERE kind = 'daily' ORDER BY id DESC LIMIT 1").get() as { message: string } | undefined;
  const modeSetting = s.approvalMode === "alternate"
    ? "2つのモードに交互に割り当て"
    : s.approvalMode === "confidence"
      ? `AIの自信が${Math.round(s.autoConfidence * 100)}%以上なら自動`
      : MODE_LABEL[s.approvalMode];
  return (
    <div className="space-y-4">
      <PageIntro title="案件の一覧">AIが進めている案件を、段階ごとに並べています。押すと、その案件で何を考えて何をしたかが見られます。</PageIntro>
      <section className="space-y-2">
        {projects.length === 0 ? (
          <div className="card p-6 text-sm text-ink-2">
            まだ案件がありません。下の「アイデアを出す」でAIに考えさせてください。
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {COLUMNS.map((col) => {
              const items = projects.filter((p) => col.stages.includes(p.stage));
              return (
                <div key={col.title} className="space-y-2 rounded-xl bg-surface-2 p-2">
                  <div className="px-1">
                    <div className="text-sm font-bold">{col.title} <span className="num font-normal text-muted">{items.length}</span></div>
                    <div className="text-xs text-muted">{col.who}</div>
                  </div>
                  <ShowMore initial={5} className="space-y-2">{items.map((p) => <ProjectCard key={p.id} p={p} pending={pendingByProject.has(p.id)} target={targetRate(p.kind, s)} />)}</ShowMore>
                </div>
              );
            })}
          </div>
        )}
        {/* 集客お休み（hold）の案件は、集客中の列に混ぜず、ある時だけ別の欄に出す */}
        {projects.some((p) => p.stage === "hold") && (
          <div className="mt-3 rounded-xl bg-surface-2 p-2">
            <div className="px-1 text-sm font-bold">⏸ 公開中・集客お休み <span className="num font-normal text-muted">{projects.filter((p) => p.stage === "hold").length}</span></div>
            <div className="px-1 text-xs text-muted">公開と記録は続けたまま、宣伝・判断・改善を止めている案件。再開日に自動で集客へ戻る</div>
            <ul className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              {projects.filter((p) => p.stage === "hold").sort((a, b) => (a.hold_until ?? "").localeCompare(b.hold_until ?? "")).map((p) => (
                <li key={p.id}>
                  <Link href={`/projects/${p.id}`} className="card block p-3 hover:border-accent">
                    <div className="line-clamp-2 text-sm font-medium">{p.title}</div>
                    <div className="num mt-1 text-xs text-ink-2">{p.hold_until} に再開</div>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* 新しいアイデア: 毎日の自動実行と、テーマを決めて今すぐ出させる操作（ホームから移した） */}
      <section id="ideas" className="scroll-mt-4 space-y-2">
        <h2 className="font-bold">アイデア出し</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          <DailyCard
            enabled={s.dailyEnabled}
            hour={s.dailyHour}
            lastRun={s.lastDailyRun}
            lastMessage={lastDaily?.message ?? null}
            count={s.dailyIdeaCount}
            keep={s.dailyKeep}
            modeLabel={modeSetting}
          />
          <IdeaForm authors={ideaAuthors().map((id) => getModel(id).label)} />
        </div>
      </section>
    </div>
  );
}

function ProjectCard({ p, pending, target }: { p: ProjectRow; pending: boolean; target: number }) {
  const t = ["live", "deciding", "continued", "killed"].includes(p.stage) ? projectTotals(p.id) : null;
  const result = p.stage === "continued" ? { c: "var(--good)", i: "✓" } : p.stage === "killed" ? { c: "var(--critical)", i: "✕" } : p.stage === "rejected" ? { c: "var(--muted)", i: "–" } : null;
  return (
    <Link href={`/projects/${p.id}`} className="card block space-y-1 p-3 hover:border-accent">
      {/* タイトルは幅いっぱいに使い、タグはその下に並べる（タグが多くてもタイトルが潰れないように） */}
      <div className="line-clamp-2 text-sm font-medium">{p.title}</div>
      <div className="flex flex-wrap gap-1">
        {p.kind === "tool" && <span className="rounded border border-line px-1 text-[10px] text-ink-2">ツール</span>}
        <span className="rounded border border-line px-1 text-[10px] text-ink-2">{p.auto_published ? "AIだけで公開" : p.mode === "auto" ? "自動" : "承認"}</span>
        {!!p.growth_phase && <span className="rounded border border-line px-1 text-[10px]" style={{ color: "var(--good)" }}>育成中</span>}
        {p.demo ? <span className="rounded border border-line px-1 text-[10px] text-muted">デモ</span> : null}
      </div>
      <div className="line-clamp-2 text-xs text-ink-2">{p.target}</div>
      {t && (
        <div className="num text-xs text-ink-2">
          訪問 {t.visits} / {CONV[p.kind].noun} {t.signups}（<span style={{ color: t.rate >= target ? "var(--good)" : "var(--text-2)" }}>{pct(t.rate, 1)}</span>）
        </div>
      )}
      {p.improve_count > 0 && <div className="text-xs text-ink-2">改善 {p.improve_count}回（第{p.lp_version}版）</div>}
      {pending && <div className="text-xs font-medium text-accent">● あなたの判断待ち</div>}
      {!!p.auto_published && !p.human_review && <div className="text-xs font-medium text-accent">● あとから確認してください</div>}
      {result && <div className="text-xs font-medium" style={{ color: result.c }}>{result.i} {STAGE_LABEL[p.stage]}</div>}
    </Link>
  );
}
