import Link from "next/link";
import { isOwner } from "@/lib/viewer";
import { ShowMore } from "@/components/ShowMore";
import { PageIntro } from "@/components/PageIntro";
import { jstDateTime } from "@/lib/format";
import { modelInfo } from "@/lib/models";
import { openRequests, recentRequests, sourceLabel, type RequestRow } from "@/lib/plan";
import { AddProposal, AiFixRequest, AnswerRequest, ReviveIdea } from "../plan/PlanActions";
import { aiFixConfigured, aiFixPrLabel, aiFixPrUrl, aiFixPrsUrl, aiFixRetryable } from "@/lib/aiFix";

export const dynamic = "force-dynamic";

function Item({ r, owner, aiFix = false }: { r: RequestRow; owner: boolean; aiFix?: boolean }) {
  const m = r.proposer ? modelInfo(r.proposer) : null;
  return (
    <li className="space-y-1 rounded-lg border border-line p-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {r.source === "revival" && <span className="rounded px-1.5 text-xs text-accent-ink" style={{ background: "var(--accent)" }}>敗者復活</span>}
        {/* 番号を出す（「#66 をやった」など、運営者とAIのやり取りで指すため。運営者が、番号が画面にないと分からないと言った） */}
        <span className="num text-xs text-muted">#{r.id}</span>
        <span className="font-medium">{r.title}</span>
        {r.score !== null && <span className="num rounded bg-surface-2 px-1.5 text-xs">ほかのAIの評価 {r.score.toFixed(1)}点</span>}
        {r.repeats > 0 && <span className="num rounded bg-surface-2 px-1.5 text-xs">同じ趣旨の提案 ほかに{r.repeats}回</span>}
        {owner && r.status === "open" && (
          <span className="ml-auto inline-flex gap-2">
            {r.source === "revival" && r.ref_id && <ReviveIdea id={r.id} />}
            {aiFix && r.target === "system" && aiFixRetryable(r) && <AiFixRequest id={r.id} again={!!r.ai_fix_at} />}
            <AnswerRequest id={r.id} />
          </span>
        )}
      </div>
      {r.how && <div className="text-ink-2">{r.how}</div>}
      {r.why && <div className="text-xs text-muted">理由: {r.why}</div>}
      {r.ai_reply && <div className="rounded bg-surface-2 px-2 py-1 text-xs text-ink-2">AIの返事: {r.ai_reply}</div>}
      {r.ai_fix_at && (
        <div className="rounded bg-surface-2 px-2 py-1 text-xs text-ink-2">
          Claude Code に直してもらうよう頼みました（{jstDateTime(r.ai_fix_at)}）
          {owner && r.ai_fix_url && <> ・<a href={r.ai_fix_url} target="_blank" rel="noreferrer" className="underline">作業の様子</a></>}
          {" "}・{r.ai_fix_pr
            ? <a href={aiFixPrUrl(r.ai_fix_pr)} target="_blank" rel="noreferrer" className="underline">{aiFixPrLabel(r)}</a>
            : <a href={aiFixPrsUrl(r.id)} target="_blank" rel="noreferrer" className="underline">PR はまだ見つかっていません</a>}
          {owner && r.ai_fix_note && <div>あなたのひとこと: {r.ai_fix_note}</div>}
        </div>
      )}
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
  // Claude Code のルーティンがつながっていれば、運営者は提案箱から直してもらうよう頼める
  const linked = aiFixConfigured();
  const aiFix = owner && linked;
  return (
    <div className="space-y-6">
      <PageIntro title="提案箱">
        AIの社員たちが「やると効きそう」と考えたことと、{owner ? "あなた" : "運営者"}の提案を入れる場所です。朝会・定例会議のほか、判断・教訓・LPやツールのチェック・アイデアの採点などの途中でも、気づいたことが入ります。
        同じ趣旨の提案は入れずに回数を数え、作業の途中で入るものは1日5件まで。週の定例会議で3社が採点し（点のないものも採点します。コードの見直しで入った提案は採点しません）、5点未満は自動で見送りにします。返事がないまま30日たった提案も見送りにします（何度も出た提案・Claude Code に頼んだ提案は残し、同じ提案がまた出てきたら入れます）。返事（やった・見送り、ひとこと）は、次の朝会と会議でAIが振り返ります。
      </PageIntro>

      <section className="card space-y-3 p-4">
        <h2 className="font-bold">{owner ? "あなたにやってほしいこと" : "運営者へのお願い"}（{human.length}件）</h2>
        {human.length ? <ul className="space-y-2">{human.map((r) => <Item key={r.id} r={r} owner={owner} />)}</ul> : <p className="text-sm text-ink-2">今はありません。</p>}
      </section>

      <section className="card space-y-3 p-4">
        <div>
          <h2 className="font-bold">仕組みの改善（{system.length}件）</h2>
          <p className="text-xs text-muted">
            ダッシュボードの動き方（AIへの指示・集計・自動化の決まりなど）を変える提案です。
            {aiFix
              ? "「AIに直させる」を押すと、クラウドの Claude Code が直して PR を作り、チェックとレビューまで進めます。中身を見てマージするのはあなたです。マージすると、1時間以内に自動で「やった」になります。PR が作られないときは、作業の様子に理由があります。"
              : linked
                ? "運営者が採るものを選ぶと、クラウドの Claude Code が直して PR を作ります。運営者がマージすると、自動で「やった」になります。"
                : `直すときは、Claude Code に「提案箱の〇〇をやって」と伝えてください。${owner ? "Claude Code のルーティンをつなぐと、ここから頼めます（docs/SETUP-AI-FIX.md）。" : ""}`}
          </p>
        </div>
        {system.length ? <ul className="space-y-2">{system.map((r) => <Item key={r.id} r={r} owner={owner} aiFix={aiFix} />)}</ul> : <p className="text-sm text-ink-2">今はありません。</p>}
      </section>

      {owner && (
        <section className="card space-y-3 p-4">
          <div>
            <h2 className="font-bold">あなたの提案を入れる</h2>
            <p className="text-xs text-muted">AIの社員に検討してほしいことを書いてください。次の朝会で担当のAIが返事をし、計画に反映します。定例会議でも材料になります。</p>
          </div>
          <AddProposal />
          {mine.length > 0 && <ul className="space-y-2">{mine.map((r) => <Item key={r.id} r={r} owner={owner} aiFix={aiFix} />)}</ul>}
        </section>
      )}

      <section className="card space-y-3 p-4">
        <h2 className="font-bold">返事をしたもの</h2>
        {answered.length ? (
          <ShowMore as="ul" initial={10} className="space-y-1 text-sm">
            {answered.map((r) => (
              <li key={r.id}>
                <span style={{ color: r.status === "done" ? "var(--good)" : "var(--muted)" }}>{r.status === "done" ? "✓ やった" : "– 見送り"}</span>
                <span className="num ml-2 text-xs text-muted">#{r.id}</span>
                <span className="ml-1">{r.title}</span>
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
