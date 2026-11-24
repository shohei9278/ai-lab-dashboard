import Link from "next/link";
import { isOwner } from "@/lib/viewer";
import { ShowMore } from "@/components/ShowMore";
import { PageIntro } from "@/components/PageIntro";
import { jstDateTime } from "@/lib/format";
import { modelInfo } from "@/lib/models";
import { openRequests, recentRequests, sourceLabel, type RequestRow } from "@/lib/plan";
import { AddProposal, AiFixRequest, AnswerRequest, ReviveIdea } from "../plan/PlanActions";
import { aiFixConfigured, aiFixPrLabel, aiFixPrUrl, aiFixPrsUrl, aiFixRetryable } from "@/lib/aiFix";
import { AUTO_MIN_SCORE, GROWTH_MIN_SCORE, autoAskStatus, type AutoAskStatus } from "@/lib/autoAsk";

// 自動の依頼の今の様子（運営者が決めた。たまっているときに、止まっているのか・上限で待っているのか・いつ次を見るのかを分かるように）
function AutoAskPanel({ st }: { st: AutoAskStatus }) {
  const at = (ms: number) => jstDateTime(new Date(ms).toISOString());
  // 上限で待っているときは、再開の時刻のあとの最初の見回りが、次に頼む時刻
  // （ちょうど再開の時刻の見回りでは、24時間前の依頼がまだ数に入るので、その次の見回り。PR #173 の ai-review の指摘）
  const resume = st.resumeAt ? Date.parse(st.resumeAt) : null;
  let check = st.nextCheckAt;
  if (check && resume) while (check <= resume) check += 3_600_000;
  const busy = st.busy ? `#${st.busy.id}「${st.busy.title}」を ${jstDateTime(st.busy.at)} に頼み、${st.busy.pr ? `PR #${st.busy.pr} の` : "PR ができるのを"}マージまで待っています` : null;
  // 上限は、止めている・進めている間も重なりうるので、状態とは別にも出す（PR #173 の ai-review の指摘）
  const cap = st.resumeAt ? `直近24時間に${st.asked}件頼み、1日の上限（${st.max}件）に達しています。${jstDateTime(st.resumeAt)} から次を頼めます` : null;
  const state = st.off
    ? { label: "止まっています", text: `${st.off}。新しい提案は頼みません` }
    : busy
      ? { label: "進めています", text: `${busy}。${cap ? "終わっても、上限が空くまで次は頼みません" : "終わったら次を頼みます"}` }
      : cap
        ? { label: "上限で待っています", text: cap }
        : st.next
          ? { label: "次を頼みます", text: "次の見回りで頼みます" }
          : { label: "頼むものがありません", text: `頼める提案がありません（守りの提案は入ってから1日、運営者の提案は1時間待ちます。採点が${AUTO_MIN_SCORE}点未満のものは頼みません）` };
  return (
    <div className="rounded-lg border border-line bg-surface-2 p-3 text-sm" role="status">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-xs text-muted">自動の依頼</span>
        <b>{state.label}</b>
        <span className="num text-xs text-ink-2">直近24時間 {st.asked}/{st.max}件・頼める提案 {st.waiting}件</span>
      </div>
      <p className="mt-1 text-xs text-ink-2">{state.text}</p>
      {/* 止めても、止める前に頼んだ PR は進むので、見えるようにする（PR #173 の ai-review の指摘） */}
      {st.off && busy && <p className="mt-1 text-xs text-ink-2">止める前に頼んだもの: {busy}</p>}
      {cap && (st.off || busy) && <p className="mt-1 text-xs text-ink-2">{cap}</p>}
      {st.next && (
        <>
          <p className="mt-1 text-xs text-ink-2">{st.off ? (cap ? "再開して上限が空いたら次に頼む提案" : "再開したら次に頼む提案") : cap ? "上限が空いたら次に頼む提案" : "次に頼む提案"}: <b>#{st.next.id}「{st.next.title}」</b></p>
          <p className="text-xs text-muted">理由: {st.next.why.replace(/^自動: /, "")}</p>
        </>
      )}
      {!st.off && <p className="mt-1 text-xs text-muted">次に見る時刻: {check ? `${at(check)}ごろ` : resume ? `${at(resume)} のあとの最初の見回り` : "次の見回り（5分以内）"}（1時間に1回見て、1件ずつ頼みます）</p>}
    </div>
  );
}

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
  const autoAsk = autoAskStatus();
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
            {linked
              ? `押さなくても、1時間に1回、1件ずつ自動でクラウドの Claude Code に頼みます（1日${autoAsk.max}件まで）。頼む順は、コードの見直しの守り（入ってから1日後）→ 運営者の提案（1時間後）→ 定例会議の採点の高い順（${GROWTH_MIN_SCORE}点以上が先、${AUTO_MIN_SCORE}点以上まで）。Claude Code が直して PR を作り、CI と2社のレビューが通れば自動でマージし、「やった」になります。直さなくてよいと判断したものは見送ります。${aiFix ? "急ぐものは「AIに直させる」で先に頼めます。" : ""}`
              : `直すときは、Claude Code に「提案箱の〇〇をやって」と伝えてください。${owner ? "Claude Code のルーティンをつなぐと、ここから頼めます（docs/SETUP-AI-FIX.md）。" : ""}`}
          </p>
        </div>
        {linked && <AutoAskPanel st={autoAsk} />}
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
