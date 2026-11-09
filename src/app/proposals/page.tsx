import Link from "next/link";
import { isOwner } from "@/lib/viewer";
import { ShowMore } from "@/components/ShowMore";
import { PageIntro } from "@/components/PageIntro";
import { jstDateTime } from "@/lib/format";
import { modelInfo } from "@/lib/models";
import { openRequests, recentRequests, type RequestRow } from "@/lib/plan";
import { AddProposal, AnswerRequest, ReviveIdea } from "../plan/PlanActions";

export const dynamic = "force-dynamic";

const SOURCE: Record<string, string> = {
  plan: "朝会", meeting: "週の定例会議", scene: "作業の途中で", error: "エラーの見張り", revival: "敗者復活", human: "あなた", voice: "社員の声から",
};

// 臨時会議の提案も source は meeting なので、場面の名前で見分ける
const sourceLabel = (r: RequestRow) => (r.source === "meeting" && r.scene?.startsWith("臨時会議") ? r.scene : SOURCE[r.source] ?? r.source);

function Item({ r, owner }: { r: RequestRow; owner: boolean }) {
  const m = r.proposer ? modelInfo(r.proposer) : null;
  return (
    <li className="space-y-1 rounded-lg border border-line p-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {r.source === "revival" && <span className="rounded px-1.5 text-xs text-accent-ink" style={{ background: "var(--accent)" }}>敗者復活</span>}
        <span className="font-medium">{r.title}</span>
        {r.score !== null && <span className="num rounded bg-surface-2 px-1.5 text-xs">ほかのAIの評価 {r.score.toFixed(1)}点</span>}
        {owner && r.status === "open" && (
          <span className="ml-auto inline-flex gap-2">
            {r.source === "revival" && r.ref_id && <ReviveIdea id={r.id} />}
            <AnswerRequest id={r.id} />
          </span>
        )}
      </div>
      {r.how && <div className="text-ink-2">{r.how}</div>}
      {r.why && <div className="text-xs text-muted">理由: {r.why}</div>}
      {r.ai_reply && <div className="rounded bg-surface-2 px-2 py-1 text-xs text-ink-2">AIの返事: {r.ai_reply}</div>}
      <div className="text-xs text-muted">
        {sourceLabel(r)}{r.scene && r.source === "scene" ? `（${r.scene}）` : ""}
        {r.project_id && <> ・<Link href={`/projects/${r.project_id}`} className="underline">#{r.project_id}</Link></>}
        {m && <> ・提案: <span style={{ color: `var(--series-${m.provider})` }}>{m.label}</span></>}
        ・{jstDateTime(r.created_at)}
        {r.meeting_id && <> ・<Link href={`/meetings#meeting-${r.meeting_id}`} className="underline">議事録</Link></>}
      </div>
    </li>
  );
}

// 提案箱: AIたちが「やると効きそう」と考えたこと（運営者にやってほしいこと・仕組みの改善）を1か所に集める
export default async function ProposalsPage() {
  const owner = await isOwner();
  const human = openRequests("human");
  const system = openRequests("system").filter((r) => r.source !== "human");
  const mine = openRequests("system").filter((r) => r.source === "human");
  const answered = recentRequests(40).filter((r) => r.status !== "open");
  return (
    <div className="space-y-6">
      <PageIntro title="提案箱">
        AIの社員たちが「やると効きそう」と考えたことと、あなたの提案を入れる場所です。朝会・定例会議のほか、判断・教訓・LPやツールのチェック・アイデアの採点などの途中でも、気づいたことが入ります。
        同じ題は入れず、作業の途中で入るものは1日5件まで。週の定例会議で3社が採点し、5点未満は自動で見送りにします。返事（やった・見送り、ひとこと）は、次の朝会と会議でAIが振り返ります。
      </PageIntro>

      <section className="card space-y-3 p-4">
        <h2 className="font-bold">あなたにやってほしいこと（{human.length}件）</h2>
        {human.length ? <ul className="space-y-2">{human.map((r) => <Item key={r.id} r={r} owner={owner} />)}</ul> : <p className="text-sm text-ink-2">今はありません。</p>}
      </section>

      <section className="card space-y-3 p-4">
        <div>
          <h2 className="font-bold">仕組みの改善（{system.length}件）</h2>
          <p className="text-xs text-muted">ダッシュボードの動き方（AIへの指示・集計・自動化の決まりなど）を変える提案です。直すときは、Claude Code に「提案箱の〇〇をやって」と伝えてください。</p>
        </div>
        {system.length ? <ul className="space-y-2">{system.map((r) => <Item key={r.id} r={r} owner={owner} />)}</ul> : <p className="text-sm text-ink-2">今はありません。</p>}
      </section>

      {owner && (
        <section className="card space-y-3 p-4">
          <div>
            <h2 className="font-bold">あなたの提案を入れる</h2>
            <p className="text-xs text-muted">AIの社員に検討してほしいことを書いてください。次の朝会で担当のAIが返事をし、計画に反映します。定例会議でも材料になります。</p>
          </div>
          <AddProposal />
          {mine.length > 0 && <ul className="space-y-2">{mine.map((r) => <Item key={r.id} r={r} owner={owner} />)}</ul>}
        </section>
      )}

      <section className="card space-y-3 p-4">
        <h2 className="font-bold">返事をしたもの</h2>
        {answered.length ? (
          <ShowMore as="ul" initial={10} className="space-y-1 text-sm">
            {answered.map((r) => (
              <li key={r.id}>
                <span style={{ color: r.status === "done" ? "var(--good)" : "var(--muted)" }}>{r.status === "done" ? "✓ やった" : "– 見送り"}</span>
                <span className="ml-2">{r.title}</span>
                <span className="ml-2 text-xs text-muted">{r.source === "human" ? "あなたの提案" : r.target === "system" ? "仕組み" : "あなたへ"}・{sourceLabel(r)}{r.score !== null ? `・${r.score.toFixed(1)}点` : ""}</span>
                {r.note && <span className="ml-2 text-xs text-ink-2">（{r.note}）</span>}
              </li>
            ))}
          </ShowMore>
        ) : <p className="text-sm text-ink-2">まだありません。</p>}
      </section>
    </div>
  );
}
