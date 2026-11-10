import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { db, getSettings, type ProjectRow } from "@/lib/db";
import { CONV, KIND_LABEL, STAGE_LABEL, ideaAuthorStats, projectTotals } from "@/lib/loop";
import { modelInfo } from "@/lib/models";
import { costEfficiency } from "@/lib/cost";
import { publicUrl } from "@/lib/publish";
import { NOTE_CERTAINTY, NOTE_TOPICS, type NoteRow } from "@/lib/notes";
import { listReports, type Report } from "@/lib/report";
import { jstDate, pct } from "@/lib/format";
import { BOTTLENECK_LABEL, GOAL_LABEL, planProgress, recentPlans } from "@/lib/plan";
import { jstDay } from "@/lib/sns";
import { listVoices } from "@/lib/voices";
import { VoiceList } from "@/components/VoiceList";
import { InterventionCard } from "@/components/InterventionList";
import { listInterventions } from "@/lib/interventions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "AIが自動でプロダクトを作る実験",
  description: "Claude・GPT・Gemini の3社のAIを社員にした、小さなプロダクト会社の実験の記録です。",
};

// 実験の様子を外に見せる、見るだけのページ（パスワードなしで開ける）
// 載せるのは、実案件のうち公開したもの・終わったものだけ。まだ公開していないアイデアや、承認待ちの中身は出さない
export default function Showcase() {
  const plans = recentPlans(7);
  const voices = listVoices({ limit: 12 });
  const interventions = listInterventions();
  const s = getSettings();
  if (!s.showcaseEnabled) notFound();

  const projects = (db().prepare("SELECT * FROM projects WHERE demo = 0 AND (public_version IS NOT NULL OR stage IN ('continued','killed')) ORDER BY id DESC").all() as ProjectRow[]);
  const all = db().prepare("SELECT COUNT(*) AS n FROM projects WHERE demo = 0").get() as { n: number };
  const ideas = db().prepare("SELECT COUNT(*) AS n FROM idea_candidates").get() as { n: number };
  const cost = costEfficiency().all;
  const aiTotal = (db().prepare("SELECT COALESCE(SUM(cost_usd),0) AS s FROM ai_calls").get() as { s: number }).s * s.usdJpy;
  const notes = db().prepare("SELECT * FROM notes WHERE is_public = 1 ORDER BY at DESC").all() as NoteRow[];
  const latest = listReports()[0];
  const report = latest ? (JSON.parse(latest.content) as Report) : null;
  const authors = ideaAuthorStats().filter((a) => a.candidates > 0);
  const yen = (x: number) => `${Math.round(x).toLocaleString("ja-JP")}円`;

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold">AIが自動でプロダクトを作る実験</h1>
        <p className="text-ink-2">
          Claude・GPT・Gemini の3社のAIを社員にした、小さなプロダクト会社の実験です。社員どうしでアイデアを出して採点し合い、紹介ページや小さなツールを作って公開し、SNSで人を呼び、反応を見て「続ける・改善・撤退」まで決めます。
          毎朝の朝会で今日やることを決め、週1回の定例会議で振り返ります。人は社長として、あとから確認したり、提案に返事をしたりするだけです。このページは、その記録を自動で表示しています。
        </p>
        <Link href="/" className="inline-block rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-ink">実際のダッシュボードを見る（閲覧専用）</Link>
      </header>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Tile label="AIが出したアイデア" value={`${ideas.n}件`} />
        <Tile label="進めた案件" value={`${all.n}件`} />
        <Tile label="公開した案件" value={`${projects.filter((p) => p.public_version !== null).length}件`} />
        <Tile label="訪問（累計）" value={`${cost.visits}人`} />
        <Tile label="登録・利用（累計）" value={`${cost.conversions}件`} />
        <Tile label="AI費用（累計）" value={yen(aiTotal)} sub={cost.perConversion === null ? undefined : `成果1件あたり ${yen(cost.perConversion)}`} />
      </section>

      {report && (
        <section className="card space-y-2 p-4">
          <h2 className="font-bold">今週のまとめ（AIが作成）</h2>
          <p className="whitespace-pre-wrap text-sm">{report.summary}</p>
          <p className="text-xs text-muted">{latest!.period_start}〜{latest!.period_end}</p>
        </section>
      )}

      {/* 社員の声（設定で載せると決めたときだけ） */}
      {s.showcaseVoices && voices.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-bold">社員の声</h2>
          <p className="text-xs text-muted">AIの社員が、ふだんの作業や会議の途中でこぼした、ひとことです。</p>
          <div className="card p-4"><VoiceList voices={voices} owner={false} compact /></div>
        </section>
      )}

      {/* AIの日報: 毎朝AIが決めたネック・方針と、その日どこまで届いたか（あなたへのお願いは載せない） */}
      {plans.length > 0 && (
        <section className="space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-bold">AIの日報</h2>
            <Link href="/diary" className="text-sm text-accent underline">すべて見る</Link>
          </div>
          <p className="text-xs text-muted">毎朝、Claude・GPT・Gemini が日替わりで全案件を振り返り、今のネックと今日やること（SNSへの投稿・ページの改善など）を決めて、自分で実行しています。</p>
          <div className="space-y-2">
            {plans.slice(0, 3).map((p) => {
              const g = planProgress(p);
              const m = modelInfo(p.model_id);
              const live = p.day === jstDay();
              return (
                <article key={p.id} className="card space-y-1.5 p-4 text-sm">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="num font-bold">{p.day.slice(5).replace("-", "/")}</span>
                    <span className="text-xs" style={{ color: `var(--series-${m.provider})` }}>担当 {m.label}</span>
                    <span className="text-xs text-ink-2">ネック: {BOTTLENECK_LABEL[g.content.bottleneck].split("（")[0]}</span>
                    <span className="num ml-auto text-xs text-ink-2">
                      予定 {g.done}/{g.total}件{live ? "（進行中）" : ""}
                      {g.goals.map((x) => `・${GOAL_LABEL[x.metric]} ${x.actual}/${x.target}${x.rate >= 1 ? " ✓" : ""}`).join("")}
                    </span>
                  </div>
                  <p className="font-medium">{g.content.focus}</p>
                  <p className="line-clamp-3 text-ink-2">{g.content.review}</p>
                </article>
              );
            })}
          </div>
        </section>
      )}

      <section className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-bold">人の手が入った記録</h2>
          <Link href="/interventions" className="text-sm text-accent underline">すべて見る（{interventions.length}件）</Link>
        </div>
        <p className="text-sm text-ink-2">コード生成には主に Claude Code を活用しています。人間は問題の発見、方針決定、動作確認を担当し、原因調査や修正にもAIを活用しています。</p>
        <div className="grid gap-3 lg:grid-cols-3">{interventions.slice(0, 3).map((v) => <InterventionCard key={v.id} v={v} />)}</div>
      </section>

      <section className="space-y-2">
        <h2 className="font-bold">公開した案件</h2>
        {projects.length === 0 ? <p className="text-sm text-ink-2">まだありません。</p> : (
          <div className="card overflow-x-auto">
            <table className="m-cards w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr className="border-b border-line">
                  <th className="px-3 py-2">案件</th>
                  <th className="px-3 py-2">形</th>
                  <th className="px-3 py-2">いまの段階</th>
                  <th className="px-3 py-2">アイデアを出したAI</th>
                  <th className="px-3 py-2 text-right">訪問</th>
                  <th className="px-3 py-2 text-right">成果の率</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => {
                  const t = projectTotals(p.id);
                  const url = s.showcaseShowLinks ? publicUrl(p.id) : null;
                  const m = modelInfo(p.idea_model ?? p.model_id);
                  return (
                    <tr key={p.id} className="num border-b border-line last:border-0">
                      <td className="m-wide px-3 py-2 font-medium sm:font-normal">{url ? <a href={url} target="_blank" rel="noreferrer" className="text-accent underline">{p.title}</a> : p.title}</td>
                      <td data-label="形" className="px-3 py-2 text-xs">{KIND_LABEL[p.kind]}</td>
                      <td data-label="いまの段階" className="px-3 py-2 text-xs">{STAGE_LABEL[p.stage]}</td>
                      <td data-label="アイデアを出したAI" className="px-3 py-2 text-xs"><span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: `var(--series-${m.provider})` }} />{m.label}</td>
                      <td data-label="訪問" className="px-3 py-2 text-right">{t.visits}</td>
                      <td data-label="成果の率" className="px-3 py-2 text-right">{t.visits ? `${CONV[p.kind].rate} ${pct(t.rate, 1)}` : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {authors.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-bold">AIどうしの採点</h2>
          <p className="text-sm text-ink-2">アイデアは作者を伏せて3社全員で採点します。「自分の案への点」が「他社からの点」より高いと、自分の案をひいきしている可能性があります。</p>
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr className="border-b border-line">
                  <th className="px-3 py-2">AI</th>
                  <th className="px-3 py-2 text-right">選ばれた / 出した案</th>
                  <th className="px-3 py-2 text-right">他社からの点</th>
                  <th className="px-3 py-2 text-right">自分の案への点</th>
                </tr>
              </thead>
              <tbody>
                {authors.map((a) => {
                  const m = modelInfo(a.author);
                  return (
                    <tr key={a.author} className="num border-b border-line last:border-0">
                      <td className="px-3 py-2"><span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full" style={{ background: `var(--series-${m.provider})` }} />{m.label}</td>
                      <td className="px-3 py-2 text-right">{a.selected} / {a.candidates}</td>
                      <td className="px-3 py-2 text-right">{a.scoreFromOthers?.toFixed(1) ?? "—"}</td>
                      <td className="px-3 py-2 text-right">{a.scoreFromSelf?.toFixed(1) ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {notes.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-bold">実験で気づいたこと</h2>
          <ol className="space-y-3">
            {notes.map((n) => (
              <li key={n.id} className="card p-4">
                <div className="flex flex-wrap gap-2 text-xs text-muted">
                  <span className="num">{jstDate(n.at)}</span>
                  <span>{NOTE_TOPICS[n.topic]}</span>
                  <span>{NOTE_CERTAINTY[n.certainty].label}</span>
                </div>
                <h3 className="mt-1 font-bold">{n.title}</h3>
                {n.body && <p className="mt-1 whitespace-pre-wrap text-sm text-ink-2">{n.body}</p>}
              </li>
            ))}
          </ol>
        </section>
      )}

      <footer className="border-t border-line pt-4 text-xs text-muted">数字は自動で更新されます。件数が少ないうちの差は、偶然の可能性が高いことにご注意ください。</footer>
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card p-3">
      <div className="text-xs text-muted">{label}</div>
      <div className="num mt-1 text-xl font-bold">{value}</div>
      {sub && <div className="text-xs text-ink-2">{sub}</div>}
    </div>
  );
}
