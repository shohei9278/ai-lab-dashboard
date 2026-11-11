import { HIDDEN, isOwner, maskEventsForGuest } from "@/lib/viewer";
import { CHOICE_LABEL, SOURCE_LABEL, listExternalVoices } from "@/lib/outside";
import { AddOutsideVoice } from "@/app/outside/OutsideActions";
import { listVoices } from "@/lib/voices";
import { VoiceList } from "@/components/VoiceList";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db, getSettings, type EventRow } from "@/lib/db";
import { modelInfo } from "@/lib/models";
import type { PageJudge } from "@/lib/freePage";
import { CONV, KIND_LABEL, MODE_LABEL, STAGE_LABEL, END_REASON_LABEL, buildingNow, jstToday, getProject, lpCandidates, pageCandidates, pageCandidateLabel, lpVersions, projectTotals, targetRate, type Lp, type Review } from "@/lib/loop";
import { LpCandidates } from "@/components/LpCandidates";
import { THEMES } from "../../../../lp-site/src/lp/content";
import { maskEvents, pendingApprovals } from "@/lib/views";
import { jstDateTime, pct, yen } from "@/lib/format";
import { ApprovalCard } from "@/components/ApprovalCard";
import { Stat } from "@/components/ui";
import { ProjectActions } from "./ProjectActions";
import { HoldPanel } from "./HoldPanel";
import { RevisionForm } from "./RevisionForm";
import { ToolTestCard } from "./ToolTestCard";
import { NotifyCard } from "./NotifyCard";
import { IllustrationControls } from "./IllustrationControls";
import { PageCheckCard } from "./PageCheckCard";
import { PageCandidatesCard } from "./PageCandidatesCard";
import { AutoReviewCard } from "./AutoReviewCard";
import { EventLog } from "./EventLog";
import { FunnelCard } from "./FunnelCard";
import { getWant } from "@/lib/userWants";
import { channelRows, funnel, funnelVersions } from "@/lib/funnel";
import { eventDetails } from "@/lib/eventDetails";
import { SnsPosts } from "./SnsPosts";
import { listPosts, postLink } from "@/lib/sns";
import { projectCost } from "@/lib/cost";
import { publicUrl } from "@/lib/publish";
import { ShadowJudgments } from "@/components/ShadowJudgments";
import { plainIssue } from "@/lib/issueText";

export const dynamic = "force-dynamic";

const STEPS = ["idea", "lp", "live", "deciding"] as const;

export default async function ProjectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ fv?: string }> }) {
  const { id } = await params;
  const p = getProject(Number(id));
  if (!p) notFound();
  const s = getSettings();
  const want = p.want_id ? getWant(p.want_id) : undefined;
  const t = projectTotals(p.id);
  const approvals = pendingApprovals(p.id);
  const fv = Number((await searchParams).fv);
  const owner = await isOwner();
  const events = maskEventsForGuest(maskEvents(db().prepare("SELECT * FROM events WHERE project_id = ? ORDER BY id DESC").all(p.id) as EventRow[]), owner);
  const projectVoices = listVoices({ projectId: p.id, limit: 20 });
  const outside = listExternalVoices({ projectId: p.id, limit: 20 });
  const aiCost = (db().prepare("SELECT COALESCE(SUM(cost_usd), 0) AS s, COUNT(*) AS n FROM ai_calls WHERE project_id = ?").get(p.id) as { s: number; n: number });
  const lp = p.lp ? (JSON.parse(p.lp) as Lp) : null;
  const ended = ["continued", "killed", "rejected"].includes(p.stage);
  const stepIndex = ended ? STEPS.length : STEPS.indexOf((p.stage === "hold" ? "live" : p.stage) as (typeof STEPS)[number]);
  const adRatio = s.adBudgetPerProjectJpy ? t.adSpendJpy / s.adBudgetPerProjectJpy : 0;
  const versions = lpVersions(p.id);
  const conv = CONV[p.kind];
  const target = targetRate(p.kind, s);
  const isTool = p.kind === "tool";
  const shares = t.rows.reduce((n, r) => n + (r.shares ?? 0), 0);
  // 3社が作ったLPの候補（今の版のもの）。公開の判断が済むまでは作者を伏せる
  const publishPending = approvals.some((a) => a.kind === "publish");
  const cands = lpCandidates(p.id).filter((c) => c.version === p.lp_version);
  // 今のLP: 人が切り替えた候補があればそれ、なければAIが選んだ候補
  const humanPicked = cands.some((c) => c.human_selected);
  const candidateViews = cands.map((c) => {
    const clp = JSON.parse(c.lp) as Lp;
    const info = modelInfo(c.author_model);
    const hide = publishPending && !p.demo;
    return {
      id: c.id, label: c.label, avg: c.avg_score, headline: clp.headline,
      author: hide ? null : info.label, provider: hide ? null : info.provider,
      theme: clp.design ? THEMES[clp.design.theme]?.label ?? null : null,
      selected: !!c.selected, humanSelected: !!c.human_selected,
      current: humanPicked ? !!c.human_selected : !!c.selected,
    };
  });
  // 毎回承認モードで、あなたが最初に承認するまでは、アイデアの作者を伏せる（先入観にならないように）。自動で進む案件は伏せない
  const authorHidden = !p.demo && p.mode === "manual" && !db().prepare("SELECT 1 FROM approvals WHERE project_id = ? AND status != 'pending'").get(p.id);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Link href="/projects" className="text-sm text-accent underline">← 案件の一覧</Link>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-bold">{p.title}</h1>
          <span className="rounded border border-line px-1.5 py-0.5 text-xs">{STAGE_LABEL[p.stage]}</span>
          {p.stage === "killed" && p.end_reason && <span className="rounded border border-line px-1.5 py-0.5 text-xs text-ink-2">撤退の理由: {END_REASON_LABEL[p.end_reason] ?? p.end_reason}</span>}
          {!!p.growth_phase && <span className="rounded px-1.5 py-0.5 text-xs font-medium" style={{ background: "var(--surface-2)", color: "var(--good)" }}>育てる段階（実験 {p.growth_count}回）</span>}
          <span className="rounded border border-line px-1.5 py-0.5 text-xs text-ink-2">{KIND_LABEL[p.kind]}</span>
          <span className="rounded border border-line px-1.5 py-0.5 text-xs text-ink-2">{MODE_LABEL[p.mode]}モード</span>
          {p.origin === "daily" && <span className="rounded border border-line px-1.5 py-0.5 text-xs text-ink-2">毎日の自動実行で作成</span>}
          {p.demo ? <span className="rounded border border-line bg-surface-2 px-1.5 py-0.5 text-xs text-ink-2">デモ</span> : null}
        </div>
        <p className="text-sm text-ink-2">このページでは、AIがこの案件で何を考え、何をして、どんな結果になったかが分かります。</p>
        <ol className="flex flex-wrap gap-1 text-xs" aria-label="進み具合">
          {[...STEPS.map((st) => STAGE_LABEL[st]), "結果"].map((label, i) => (
            <li key={label} className={`rounded-full px-2 py-0.5 ${i <= stepIndex ? "bg-accent text-accent-ink" : "bg-surface-2 text-muted"}`}>
              {i + 1}. {label}
            </li>
          ))}
        </ol>
      </div>

      {approvals.map((a) => <ApprovalCard key={a.id} a={a} />)}

      <ProjectActions demo={!!p.demo} isTool={isTool} building={buildingNow(p.id)} id={p.id} convNoun={conv.noun} stage={p.stage} hasLp={!!lp} hasPending={approvals.length > 0} judgeMinVisits={s.judgeMinVisits} publicUrl={p.public_slug ? publicUrl(p.id) ?? `(URL未設定)/${p.public_slug}` : null} />

      {owner && !p.demo && ["live", "hold"].includes(p.stage) && (
        <HoldPanel id={p.id} held={p.stage === "hold"} reason={p.hold_reason} until={p.hold_until} today={jstToday()} blocked={approvals.length > 0 || !!buildingNow(p.id)} />
      )}
      {!owner && p.stage === "hold" && (
        <div className="card p-4 text-sm text-ink-2">⏸ 保留中です。公開は続けたまま、宣伝と判断を止めています（{p.hold_until}に再開）。</div>
      )}

      {/* 一番見たい数字を上に置く */}
      {t.rows.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-bold">集客の結果{t.simulated && <span className="ml-2 text-xs font-normal text-muted">シミュレーションを含む</span>}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Stat label="訪問" value={`${t.visits}人`} sub={`判断の目安 ${s.judgeMinVisits}人`} />
            <Stat label={isTool ? "使った人" : "事前登録"} value={`${t.signups}人`} sub={isTool ? `シェア ${shares}人` : undefined} />
            <Stat
              label={conv.rate}
              value={<span style={{ color: t.rate >= target ? "var(--good)" : undefined }}>{pct(t.rate, 1)}</span>}
              sub={`目標 ${pct(target, 1)} ${t.rate >= target ? "✓ 達成" : "（未達）"}`}
            />
            <Stat label="広告費" value={`${t.adSpendJpy.toLocaleString("ja-JP")}円`} sub={`上限 ${s.adBudgetPerProjectJpy.toLocaleString("ja-JP")}円 の ${pct(adRatio)}`} />
            {(() => {
              const c = projectCost(p.id);
              return (
                <Stat
                  label={`${conv.noun}1件あたりの費用`}
                  value={c.perConversion === null ? "—" : `${Math.round(c.perConversion).toLocaleString("ja-JP")}円`}
                  sub={`AI ${Math.round(c.aiJpy).toLocaleString("ja-JP")}円＋広告 ${c.adJpy.toLocaleString("ja-JP")}円`}
                />
              );
            })()}
          </div>
          <div className="card overflow-x-auto">
            <table className="m-scroll w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr className="border-b border-line">
                  <th className="px-3 py-2">日付</th>
                  <th className="px-3 py-2 text-right">訪問</th>
                  <th className="px-3 py-2 text-right">{conv.noun}</th>
                  <th className="px-3 py-2 text-right">{conv.rate}</th>
                  {isTool && <th className="px-3 py-2 text-right">シェア</th>}
                  <th className="px-3 py-2 text-right">広告費</th>
                  <th className="px-3 py-2">LPの版</th>
                  <th className="px-3 py-2">データ</th>
                </tr>
              </thead>
              <tbody>
                {t.rows.map((r) => (
                  <tr key={r.id} className="num border-b border-line last:border-0">
                    <td className="px-3 py-2">{r.day}</td>
                    <td className="px-3 py-2 text-right">{r.visits}</td>
                    <td className="px-3 py-2 text-right">{r.signups}</td>
                    <td className="px-3 py-2 text-right">{r.visits ? pct(r.signups / r.visits, 1) : "—"}</td>
                    {isTool && <td className="px-3 py-2 text-right">{r.shares}</td>}
                    <td className="px-3 py-2 text-right">{r.ad_spend_jpy.toLocaleString("ja-JP")}円</td>
                    <td className="px-3 py-2 text-xs text-ink-2">第{r.lp_version}版</td>
                    <td className="px-3 py-2 text-xs text-ink-2">{r.source === "simulated" ? "シミュレーション" : r.source === "real" ? "実データ" : "手入力"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* 企画の中身は長いので、開いたときだけ読む */}
      <details className="card p-4">
        <summary data-demo-ok className="cursor-pointer font-bold">AIのアイデア（誰向け・困りごと・解決策・仮説）</summary>
        <div className="mt-3 space-y-3">
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <Item label="誰向け">{p.target}</Item>
          <Item label="困りごと">{p.problem}</Item>
          <Item label="解決策">{p.solution}</Item>
          <Item label="検証する仮説">{p.hypothesis}</Item>
          <Item label="最初の届け方（企画のとき）">{p.first_channel ?? "—"}</Item>
          <Item label="最初の1週間の検証">{p.first_test ?? "—"}</Item>
          {want && (
            <Item label="元になった声（X）">
              {want.problem}（いいね {want.likes ?? 0}）{" "}
              <a href={want.url} target="_blank" rel="noreferrer" className="text-accent underline">投稿 ↗</a>
            </Item>
          )}
          {p.growth_focus && <Item label={`今の集客の方針（見直し ${p.rethink_count}回）`}>{p.growth_focus}</Item>}
          <Item label="AIがこれを選んだ理由">{p.ai_reason}</Item>
          <Item label="AIの自信度">{p.ai_confidence === null ? "—" : `${Math.round(p.ai_confidence * 100)}%`}</Item>
        </dl>
        <p className="text-xs text-muted">
          アイデアを考えたAI: {authorHidden ? "（あなたが最初の承認をするまで伏せています）" : modelInfo(p.idea_model ?? p.model_id).label}
          ・LPなどを作るAI: {modelInfo(p.model_id).label}
          {p.theme ? `・テーマ「${p.theme}」` : ""}・この案件のAI費用 {yen(aiCost.s, s.usdJpy)}（{aiCost.n}回）
        </p>
        </div>
      </details>

      {lp && (
        <section className="card space-y-3 p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-bold">{isTool ? "AIが作ったツール" : "AIが作ったLP"}（今は第{p.lp_version}版）</h2>
            <Link href={`/lp/${p.id}`} target="_blank" className="text-sm text-accent underline">{isTool ? "ツールを開いて試す ↗" : "LPを開く ↗"}</Link>
          </div>
          <div className="text-lg font-bold">{lp.headline}</div>
          <div className="text-sm text-ink-2">{lp.subheadline}</div>
          {lp.design && <IllustrationControls id={p.id} url={lp.design.illustration?.url ?? null} isPublic={!!p.public_slug && p.public_version === p.lp_version} />}
          {candidateViews.length > 1 && (
            <LpCandidates projectId={p.id} version={p.lp_version} items={candidateViews} canSwitch={publishPending && p.stage === "lp"} isTool={isTool} />
          )}
          {versions.length > 1 && (
            <details className="space-y-2 border-t border-line pt-3">
              <summary data-demo-ok className="cursor-pointer text-xs text-muted">版の履歴（{versions.length}版。何をどう変えたか。自動モードではAIが承認なしで改善した版もあります）</summary>
              <ol className="mt-2 space-y-2 text-sm">
                {versions.map((v) => {
                  const vlp = JSON.parse(v.lp) as Lp;
                  const review = v.review ? (JSON.parse(v.review) as Review) : null;
                  const vt = projectTotals(p.id, v.version);
                  return (
                    <li key={v.id} className="rounded-lg bg-surface-2 p-2">
                      <div className="flex flex-wrap gap-x-3 text-xs text-ink-2">
                        <span className="font-medium text-ink">第{v.version}版</span>
                        <span className="num">{jstDateTime(v.created_at)}</span>
                        <span>{v.note}</span>
                        {v.tool_model && <span>コード: {modelInfo(v.tool_model).label}{v.tool_rewrites ? `（書き直し ${v.tool_rewrites}回）` : ""}</span>}
                        {vt.visits > 0 && <span className="num">訪問 {vt.visits} / {conv.noun} {vt.signups}（{pct(vt.rate, 1)}）</span>}
                        {review && (review.ok
                          ? <span style={{ color: "var(--good)" }}>✓ チェックOK</span>
                          : <span style={{ color: "var(--critical)" }}>! {review.issues.map(plainIssue).join(" / ")}</span>)}
                      </div>
                      <div>{vlp.headline}</div>
                    </li>
                  );
                })}
              </ol>
            </details>
          )}
        </section>
      )}

      {p.notify_status === "pending" && (
        <NotifyCard
          projectId={p.id}
          count={t.signups}
          template={{
            subject: `【${p.title}】開発を見送ることになりました`,
            body: [
              `${p.title} に事前登録いただき、ありがとうございました。`,
              "",
              "検討の結果、このサービスは開発を見送ることになりました。ご関心をお寄せいただいたのに、申し訳ありません。",
              "",
              "ご登録いただいたメールアドレスは、このご連絡をもって削除します。今後、このサービスに関するメールをお送りすることはありません。",
              "",
              `運営: ${s.operatorName || "（設定で屋号を入れてください）"}`,
              `お問い合わせ: ${s.contactEmail || "（設定で問い合わせ先を入れてください）"}`,
            ].join("\n"),
          }}
        />
      )}
      {p.notify_status === "done" && (
        <p className="card p-3 text-sm text-ink-2">✓ 事前登録してくれた人への連絡と、メールアドレスの削除は済んでいます。</p>
      )}

      {p.public_slug && (() => {
        const live = p.public_version ?? p.lp_version;
        const all = funnelVersions(p).map((v) => funnel(p, v));
        const shown = all.find((x) => x.version === fv) ?? funnel(p);
        return <FunnelCard f={shown} all={all} isTool={isTool} projectId={p.id} liveVersion={live} channels={channelRows(p.id, shown.version, owner)} />;
      })()}

      {p.index_visits > 0 && (
        <p className="card p-3 text-sm text-ink-2">公開サイトの一覧から来た人: 訪問 <span className="num">{p.index_visits}</span>人・{conv.noun} <span className="num">{p.index_uses}</span>人（上の訪問の数に含まれています）</p>
      )}

      {!!p.auto_published && (
        <AutoReviewCard id={p.id} review={p.human_review} note={p.human_review_note} at={p.human_review_at} url={publicUrl(p.id)} />
      )}

      {!isTool && lp && (
        <PageCheckCard
          id={p.id}
          version={p.lp_version}
          hasPage={!!lp.page}
          isPublic={!!p.public_slug && p.public_version === p.lp_version}
          check={(() => {
            const v = versions.find((x) => x.version === p.lp_version);
            const c = v?.test ? JSON.parse(v.test) : null;
            return c?.kind === "page" ? c : null;
          })()}
        />
      )}

      {!isTool && lp?.page && (() => {
        const rows = pageCandidates(p.id, p.lp_version);
        if (rows.length < 2) return null;
        const matched = rows.some((r) => r.html && r.html === lp.page?.html);
        const cands = rows.map((r) => {
          const c = r.check_json ? (JSON.parse(r.check_json) as { issues?: string[]; shots?: string[]; pc?: string }) : {};
          return {
            id: r.id, at: r.at, label: pageCandidateLabel(r), byModel: !!r.model, score: r.score, aiPick: !!r.selected,
            current: matched ? r.html === lp.page?.html : !!r.selected, canSwitch: !!r.html,
            issues: c.issues ?? [], shots: c.shots ?? [], pc: c.pc,
          };
        });
        const judges = rows[0].judges ? (JSON.parse(rows[0].judges) as PageJudge[]).map((j) => ({ label: modelInfo(j.modelId).label, scores: [j.a, j.b], reason: j.reason })) : null;
        return <PageCandidatesCard id={p.id} reason={rows[0].reason} judges={judges} cands={cands} isPublic={!!p.public_slug && p.public_version === p.lp_version} />;
      })()}

      {isTool && lp?.tool && (
        <ToolTestCard
          id={p.id}
          version={p.lp_version}
          test={(() => {
            const v = versions.find((x) => x.version === p.lp_version);
            return v?.test ? JSON.parse(v.test) : null;
          })()}
          author={(() => {
            const v = versions.find((x) => x.version === p.lp_version);
            return v?.tool_model ? { label: modelInfo(v.tool_model).label, rewrites: v.tool_rewrites } : null;
          })()}
        />
      )}

      {p.public_slug && ["live", "hold", "lp", "deciding", "continued"].includes(p.stage) && (
        <SnsPosts
          projectId={p.id}
          convNoun={conv.noun}
          ready={!!publicUrl(p.id)}
          account={s.snsAccount}
          imageUrl={publicUrl(p.id) ? `${publicUrl(p.id)}/opengraph-image?v=${p.public_version ?? p.lp_version}` : null}
          posts={listPosts(p.id).map((x) => ({
            id: x.id, code: x.code, platform: x.platform, angle: x.angle, text: x.text, author: x.author, status: x.status === "posted" ? "posted" : "draft", postedAt: x.posted_at,
            postUrl: x.post_url, impressions: x.impressions, visits: x.visits, conversions: x.conversions, link: postLink(p.id, x.code),
          }))}
        />
      )}

      {lp && ["lp", "live"].includes(p.stage) && !approvals.some((a) => a.kind !== "publish") && (
        <RevisionForm id={p.id} isTool={isTool} isPublic={!!p.public_slug} />
      )}


      <ShadowJudgments projectId={p.id} hidePending />

      {/* 外の声（実際の人の反応） */}
      {p.public_slug && (
        <section className="card space-y-3 p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-bold">外の声（{outside.length}件）</h2>
            <Link href="/outside" className="text-sm text-accent underline">外の声をすべて見る</Link>
          </div>
          {outside.length ? (
            <ul className="space-y-1 text-sm">
              {outside.map((v) => (
                <li key={v.id} className="flex gap-2">
                  <span className="shrink-0 text-xs text-muted">{SOURCE_LABEL[v.source]}{v.choice ? `「${CHOICE_LABEL[v.choice]}」` : ""}</span>
                  <span>{owner || !v.text ? v.text : HIDDEN}</span>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-ink-2">まだありません。公開ページの「ひとこと聞かせてください」に届くか、あなたが聞いた声を記録すると、ここに出ます。</p>}
          {owner && <AddOutsideVoice projects={[{ id: p.id, title: p.title }]} defaultProjectId={p.id} />}
        </section>
      )}

      {projectVoices.length > 0 && (
        <section className="card space-y-3 p-4">
          <h2 className="font-bold">この案件への社員の声</h2>
          <VoiceList voices={projectVoices} owner={owner} />
        </section>
      )}


      <section className="space-y-2">
        <details>
          <summary data-demo-ok className="cursor-pointer font-bold">経過（{events.length}件）</summary>
          <div className="mt-2">
            <EventLog projectId={p.id} events={events.map((e) => ({ ...e, message: plainIssue(e.message) }))} details={eventDetails(p.id, events.filter((e) => !e.message.startsWith("AIが判断しました（内容は")), authorHidden)} />
          </div>
        </details>
      </section>
    </div>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
