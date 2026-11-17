import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { db, getSettings } from "@/lib/db";
import { CONV, KIND_LABEL, STAGE_LABEL } from "@/lib/loop";
import { costEfficiency } from "@/lib/cost";
import { publicUrl } from "@/lib/publish";
import { NOTE_CERTAINTY, NOTE_TOPICS, type NoteRow } from "@/lib/notes";
import { listReports, type Report } from "@/lib/report";
import { jstDate } from "@/lib/format";
import { modelInfo } from "@/lib/models";
import { BOTTLENECK_LABEL, GOAL_LABEL, planProgress, recentPlans } from "@/lib/plan";
import { jstDay } from "@/lib/sns";
import { INTERVENTION_KIND, listInterventions } from "@/lib/interventions";
import { showcaseOfficeSnapshot } from "@/lib/office";
import { memberMaker, memberProfiles, reachText, showcaseLearnings, showcaseProjects, type MemberProfile, type ShowcaseProject } from "@/lib/showcase";
import { checkEvalOverview } from "@/lib/checkEval";
import { OfficeView } from "@/app/office/OfficeView";
import { ROBOT_CSS, Robot } from "@/app/office/Robot";
import { Icon } from "@/app/office/Icons";
import { ShowMore } from "@/components/ShowMore";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "AIが自動でプロダクトを作る実験",
  description: "Claude・GPT・Gemini の3社のAIを社員にした、小さなプロダクト会社の実験の記録です。",
};

const REPO = "https://github.com/shohei9278/ai-lab-dashboard";
const FLOW = ["アイデア出し", "作者を伏せて採点", "ページ・ツールを作る", "公開前チェック", "公開", "SNSで集客", "計測", "続ける・改善・撤退", "教訓"];
const STACK: [string, string][] = [
  ["画面", "Next.js 16（App Router）・React 19・TypeScript・Tailwind CSS"],
  ["データ", "SQLite（better-sqlite3）"],
  ["AI", "Anthropic・OpenAI・Google の各SDK（Claude・GPT・Gemini）"],
  ["公開サイト", "Next.js を Vercel に。登録とページ内の動きは Supabase に送り、5分ごとに取り込む"],
  ["自動化", "Playwright（公開前の画面撮影・ツールの自動テスト）、Threads・Bluesky・X の API"],
  ["運用", "Railway（Docker）・GitHub Actions"],
];
const COLOR = { anthropic: "var(--series-anthropic)", openai: "var(--series-openai)", google: "var(--series-google)" } as const;
const NOTES = 3; // 気づいたことは新しい順に3件だけ出す（残りは資料のページで見る）
const SCALE = "10点満点";

// 実験の様子を外に見せる、見るだけのページ（パスワードなしで開ける）
// 載せるのは、実案件のうち公開したもの・終わったものだけ。まだ公開していないアイデアや、承認待ちの中身、AIの入出力は出さない
// 一番上に、ホームと同じドット絵のオフィス（見るだけの形）を置き、社員3人・案件・記録の順に並べる
export default async function Showcase() {
  const s = getSettings();
  if (!s.showcaseEnabled) notFound();

  const office = showcaseOfficeSnapshot();
  const plans = recentPlans(7);
  const interventions = listInterventions();
  const projects = showcaseProjects();
  const members = memberProfiles();
  const all = db().prepare("SELECT COUNT(*) AS n FROM projects WHERE demo = 0").get() as { n: number };
  const ideas = db().prepare("SELECT COUNT(*) AS n FROM idea_candidates").get() as { n: number };
  const cost = costEfficiency().all;
  const aiTotal = (db().prepare("SELECT COALESCE(SUM(cost_usd),0) AS s FROM ai_calls").get() as { s: number }).s * s.usdJpy;
  const notes = db().prepare("SELECT * FROM notes WHERE is_public = 1 ORDER BY at DESC").all() as NoteRow[];
  const latest = listReports()[0];
  const report = latest ? (JSON.parse(latest.content) as Report) : null;
  const yen = (x: number) => `${Math.round(x).toLocaleString("ja-JP")}円`;
  const learnings = await showcaseLearnings();
  const evals = checkEvalOverview();

  return (
    <div className="space-y-10">
      <style>{ROBOT_CSS}</style>

      {/* ファーストビュー: オフィスと、短い紹介 */}
      <header className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h1 className="text-xl font-bold sm:text-2xl">AIが自動でプロダクトを作る実験</h1>
          <p className="text-xs text-muted">AI Product Lab のオフィス（実際の記録から自動で動きます）</p>
        </div>
        <OfficeView initial={office} numbers={false} showcase />
        <div className="space-y-3 pt-1">
          <p className="text-ink-2">
            Claude・GPT・Gemini の3社のAIを社員にした、小さなプロダクト会社です。社員どうしでアイデアを出して採点し合い、紹介ページや小さなツールを作って公開し、SNSで人を呼び、反応を見て「続ける・改善・撤退」まで決めます。人は社長として、あとから確認したり、提案に返事をしたりするだけです。制限を外して作り込むツールは「じっくり案件」として作り、大きなデータが要るときは、AIが下書きしたデータを人が確かめてから作ります。
          </p>
          <Link href="/" className="inline-block rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-ink">実際のダッシュボードを見る（閲覧専用）</Link>
        </div>
      </header>

      <section className="grid grid-cols-3 gap-2 sm:gap-3 lg:grid-cols-6" aria-label="これまでの数字">
        <Tile label="AIが出したアイデア" value={`${ideas.n}件`} />
        <Tile label="進めた案件" value={`${all.n}件`} />
        <Tile label="公開した案件" value={`${projects.filter((p) => p.published).length}件`} />
        <Tile label="訪問（累計）" value={`${cost.visits}人`} />
        <Tile label="登録・利用（累計）" value={`${cost.conversions}件`} />
        <Tile label="AI費用（累計）" value={yen(aiTotal)} sub={cost.perConversion === null ? undefined : `成果1件 ${yen(cost.perConversion)}`} />
      </section>

      {/* 採用担当の人などが最初に読む要点。数字はいまの記録から入る */}
      {learnings.length > 0 && (
        <section className="space-y-3">
          <SectionHead title="分かったこと" note="実験を続けながら、数字で確かめていることです。" />
          <ol className="grid gap-3 md:grid-cols-3">
            {learnings.map((l, i) => (
              <li key={l.title} className="card space-y-1 p-4">
                <p className="num text-xs text-muted">{i + 1}</p>
                <h3 className="font-bold">{l.title}</h3>
                <p className="text-sm text-ink-2">{l.body}</p>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* どう作っているか: 仕組み・安全装置・技術・作り方 */}
      <section className="space-y-3">
        <SectionHead title="仕組みと技術" note="個人で設計・開発・運用しています。" />
        <div className="grid gap-3 md:grid-cols-2">
          <article className="card space-y-2 p-4 text-sm">
            <h3 className="font-bold">AIが回している流れ</h3>
            <ol className="flex flex-wrap items-center gap-1.5 text-xs">
              {FLOW.map((x, i) => (
                <li key={x} className="flex items-center gap-1.5">
                  <span className="rounded-full bg-surface-2 px-2 py-0.5">{x}</span>
                  {i < FLOW.length - 1 && <span aria-hidden className="text-muted">→</span>}
                </li>
              ))}
            </ol>
            <p className="text-ink-2">3社のAIが作者を伏せてアイデアを採点し合い、選ばれた案を事前登録のページか動くツールにします。公開後は毎朝、担当のAIが全案件を見てその日の投稿や直しを決め、数字がたまると「続ける・改善・撤退」を判断し、終わった案件から教訓を残します。</p>
          </article>
          <article className="card space-y-2 p-4 text-sm">
            <h3 className="font-bold">安全装置</h3>
            <ul className="list-disc space-y-1 pl-5 text-ink-2">
              <li>月の予算と緊急停止: AIを呼ぶたびに今月の費用を確かめ、上限に達したら呼び出しを止める。緊急停止ですべての呼び出しを止められる</li>
              <li>公開前チェック: AIだけで公開する前に別の工程で確かめ、そのチェック自体を正解の決まった例で評価する</li>
              <li>AIだけで公開できる件数に上限を設け、超えた分は人の判断に回す</li>
              <li>このダッシュボードは閲覧専用で公開: 来訪者の操作は入口ですべて断り、個人の情報・他人の投稿・AIの入出力は伏せる</li>
            </ul>
          </article>
          <article className="card space-y-2 p-4 text-sm">
            <h3 className="font-bold">技術</h3>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-ink-2">
              {STACK.map(([k, v]) => <div key={k} className="contents"><dt className="text-muted">{k}</dt><dd>{v}</dd></div>)}
            </dl>
          </article>
          <article className="card space-y-2 p-4 text-sm">
            <h3 className="font-bold">作り方</h3>
            <ul className="list-disc space-y-1 pl-5 text-ink-2">
              <li>コードは主に Claude Code で書き、人は問題の発見・方針の決定・動作の確認を受け持つ</li>
              <li>変更はすべてPRで、型チェック・lint・テストのCIと、別のAI（GPT）のレビューを通してから本番に出す</li>
              <li>本番に出たあとは、主要ページと閲覧専用の守りを30分ごとに自動で確かめる</li>
              <li>人が手を入れたところは「改善の記録」に残している</li>
            </ul>
            <a href={REPO} target="_blank" rel="noreferrer" className="inline-block text-accent underline">ソースコード（GitHub）↗</a>
          </article>
        </div>
      </section>

      {/* 公開前チェックの評価: AIを安全に使う工夫の、数字の裏付け */}
      {/* 1件も判定できなかった評価は出さない。答えが取れなかった例があれば、その数も出して合計が合うようにする */}
      {evals.latest.some((e) => e.ng.total + e.ok.total > 0) && (
        <section className="space-y-3">
          <SectionHead title="公開前チェックの評価" href="/lab" more="AIの成績で見る" note={`問題を1つだけ入れたページ${evals.cases.ng}件と、問題のないページ${evals.cases.ok}件を、本番と同じ指示でチェックさせた結果です（AIごとの最新）。`} />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {evals.latest.filter((e) => e.ng.total + e.ok.total > 0).map((e) => (
              <article key={e.run.id} className="card space-y-2 p-4 text-sm">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="font-bold">{modelInfo(e.run.model_id).label}</h3>
                  <span className="num text-xs text-muted">{jstDate(e.run.at)}</span>
                </div>
                <dl className="num grid grid-cols-2 gap-2 text-center">
                  <div className="rounded-md bg-surface-2 p-2"><dt className="text-xs text-muted">問題のあるページを止めた</dt><dd className="text-lg font-bold">{e.ng.caught}/{e.ng.total}</dd></div>
                  <div className="rounded-md bg-surface-2 p-2"><dt className="text-xs text-muted">問題のないページを通した</dt><dd className="text-lg font-bold">{e.ok.passed}/{e.ok.total}</dd></div>
                </dl>
                {e.failed > 0 && <p className="text-xs text-ink-2">ほかに{e.failed}件は、答えが取れず判定できませんでした</p>}
                {e.run.prompt_hash !== evals.promptHash && <p className="text-xs text-muted">このあと、チェックの指示か例を直しています</p>}
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-3">
        <SectionHead title="社員" note={`アイデアは作者を伏せて、3社全員で採点します。点は${SCALE}で、「他社から」は他社が付けた点、「自分の案へ」は自分で付けた点です。自分の案への点が0.5点を超えて高ければ「自分の案に甘め」としています。`} />
        <div className="grid gap-3 md:grid-cols-3">
          {members.map((m) => <MemberCard key={m.id} m={m} />)}
        </div>
      </section>

      <section className="space-y-3">
        <SectionHead title="公開した案件" note="AIがアイデアから作って公開した、紹介ページ（事前登録LP）と動くツールです。写真は、公開前にAIが確かめたときの画面です。" />
        {projects.length === 0 ? <p className="text-sm text-ink-2">まだありません。</p> : (
          <ShowMore initial={6} className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            {projects.map((p) => <ProjectCard key={p.id} p={p} url={s.showcaseShowLinks && p.published ? publicUrl(p.id) : null} />)}
          </ShowMore>
        )}
      </section>

      {report && (
        <section className="space-y-3">
          <SectionHead title="週のまとめ" note={`AIが作成（${latest!.period_start}〜${latest!.period_end}）`} />
          <p className="card line-clamp-6 whitespace-pre-wrap p-4 text-sm">{report.summary}</p>
        </section>
      )}

      {/* AIの日報: 毎朝AIが決めたネック・方針と、その日どこまで届いたか（あなたへのお願いは載せない） */}
      {plans.length > 0 && (
        <section className="space-y-3">
          <SectionHead title="AIの日報" href="/diary" more="すべて見る" note="毎朝、3社が日替わりで全案件を振り返り、今のネックと今日やることを決めて、自分で実行しています。" />
          <div className="space-y-2">
            {plans.slice(0, 2).map((p) => {
              const g = planProgress(p);
              const m = modelInfo(p.model_id);
              const live = p.day === jstDay();
              return (
                <article key={p.id} className="card space-y-1 p-4 text-sm">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs">
                    <span className="num text-sm font-bold">{p.day.slice(5).replace("-", "/")}</span>
                    <span style={{ color: `var(--series-${m.provider})` }}>担当 {m.label}</span>
                    <span className="text-ink-2">ネック: {BOTTLENECK_LABEL[g.content.bottleneck].split("（")[0]}</span>
                    <span className="num ml-auto text-ink-2">
                      予定 {g.done}/{g.total}件{live ? "（進行中）" : ""}
                      {g.goals.map((x) => <span key={x.metric}>・{GOAL_LABEL[x.metric]} {x.actual}/{x.target}{x.rate >= 1 && <Icon name="check" className="ml-0.5 h-3 w-3" label="達成" />}</span>)}
                    </span>
                  </div>
                  <p className="font-medium">{g.content.focus}</p>
                  <p className="line-clamp-2 text-ink-2">{g.content.review}</p>
                </article>
              );
            })}
          </div>
        </section>
      )}

      <section className="space-y-3">
        <SectionHead title="改善の記録（人が見つけた・決めた）" href="/interventions" more={`すべて見る（${interventions.length}件）`} note="コード生成には主に Claude Code を活用しています。人間は問題の発見、方針決定、動作確認を担当し、原因調査や修正にもAIを活用しています。" />
        <ul className="card divide-y divide-line text-sm">
          {interventions.slice(0, 3).map((v) => (
            <li key={v.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 p-3">
              <span className="num text-xs text-muted">{v.day.slice(5).replace("-", "/")}</span>
              <span className="rounded border border-line px-1.5 text-xs text-ink-2">{INTERVENTION_KIND[v.kind]}</span>
              <span className="font-medium">{v.title}</span>
            </li>
          ))}
        </ul>
      </section>

      {notes.length > 0 && (
        <section className="space-y-3">
          <SectionHead title="実験で気づいたこと" href={notes.length > NOTES ? "/notes" : undefined} more={`すべて見る（${notes.length}件）`} />
          <ol className="space-y-2">
            {notes.slice(0, NOTES).map((n) => (
              <li key={n.id} className="card p-4">
                <div className="flex flex-wrap gap-2 text-xs text-muted">
                  <span className="num">{jstDate(n.at)}</span>
                  <span>{NOTE_TOPICS[n.topic]}</span>
                  <span>{NOTE_CERTAINTY[n.certainty].label}</span>
                </div>
                <h3 className="mt-1 font-bold">{n.title}</h3>
                {n.body && <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-sm text-ink-2">{n.body}</p>}
              </li>
            ))}
          </ol>
        </section>
      )}

      <footer className="border-t border-line pt-4 text-xs text-muted">数字は自動で更新されます。件数が少ないうちの差は、偶然の可能性が高いことにご注意ください。</footer>
    </div>
  );
}

function SectionHead({ title, note, href, more }: { title: string; note?: string; href?: string; more?: string }) {
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-bold">{title}</h2>
        {href && more && <Link href={href} className="text-sm text-accent underline">{more}</Link>}
      </div>
      {note && <p className="text-xs text-muted sm:text-sm">{note}</p>}
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card p-2.5 sm:p-3">
      <div className="text-[10px] text-muted sm:text-xs">{label}</div>
      <div className="num mt-0.5 text-base font-bold sm:text-xl">{value}</div>
      {sub && <div className="text-[10px] text-ink-2 sm:text-xs">{sub}</div>}
    </div>
  );
}

const LEAN: Record<NonNullable<MemberProfile["lean"]>, string> = { self: "自分の案に甘め", strict: "自分の案に辛め", even: "自分の案も他社の案も、ほぼ同じに採点" };
const score = (x: number | null) => (x === null ? "—" : x.toFixed(1));

// 社員1人の紹介: ロボットの絵、役割（よくしている仕事）、アイデアが選ばれた数、採点の傾向
function MemberCard({ m }: { m: MemberProfile }) {
  return (
    <article className="card flex gap-3 p-4" style={{ borderTop: `3px solid ${COLOR[m.id]}` }}>
      <div className="grid h-20 w-16 shrink-0 place-items-center self-start rounded-lg bg-[#e6e6e6]" style={{ ["--rb-h" as string]: "56px" }}>
        <Robot member={m.id} mood="work" pixel />
      </div>
      <div className="min-w-0 flex-1 space-y-2 text-sm">
        <div>
          <h3 className="font-bold" style={{ color: COLOR[m.id] }}>{m.name}<span className="ml-1.5 text-xs font-normal text-muted">{memberMaker(m.id)}</span></h3>
          <p className="text-xs text-ink-2">{m.maker ? "LP・ツールを作る担当。" : ""}{m.jobs.length ? `よくしている仕事: ${m.jobs.join("・")}` : "まだ仕事の記録がありません"}</p>
        </div>
        <dl className="num grid grid-cols-4 gap-1 text-center text-xs md:grid-cols-2">
          {([["選ばれた案", `${m.selected}/${m.candidates}`], ["他社から", score(m.fromOthers)], ["自分の案へ", score(m.fromSelf)], ["他社の案へ", score(m.givenToOthers)]] as const).map(([k, v]) => (
            <div key={k} className="rounded-md bg-surface-2 px-1 py-1">
              <dt className="text-[10px] text-muted">{k}</dt>
              <dd className="font-bold">{v}</dd>
            </div>
          ))}
        </dl>
        {m.lean && <p className="text-xs"><span className="rounded border border-line px-1.5 py-0.5 text-ink-2">{LEAN[m.lean]}</span></p>}
      </div>
    </article>
  );
}

// 公開した案件1件: 画面写真・名前・形・段階・アイデアを出したAI・訪問と成果
function ProjectCard({ p, url }: { p: ShowcaseProject; url: string | null }) {
  const title = url ? <a href={url} target="_blank" rel="noreferrer" className="hover:underline">{p.title}</a> : p.title;
  return (
    <article className="card flex flex-col overflow-hidden p-0">
      <div className="relative aspect-[16/10] overflow-hidden border-b border-line bg-surface-2">
        {p.shot ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.shot} alt={`${p.title} の画面`} loading="lazy" className="absolute inset-0 h-full w-full object-cover object-top" />
        ) : (
          <div className="grid h-full place-items-center text-muted"><Icon name={p.kind === "tool" ? "tool" : "page"} className="h-8 w-8" label="画面写真なし" /></div>
        )}
        <span className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white sm:text-xs">
          <Icon name={p.kind === "tool" ? "tool" : "page"} />{KIND_LABEL[p.kind]}
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-1 p-2.5 sm:p-3">
        <h3 className="line-clamp-2 text-sm font-bold">{title}</h3>
        <p className="flex flex-wrap items-center gap-x-2 text-[10px] text-muted sm:text-xs">
          <span>{STAGE_LABEL[p.stage]}</span>
          {p.author && <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full" style={{ background: COLOR[p.author] }} />{p.authorLabel}の案</span>}
        </p>
        <p className="num mt-auto flex items-center gap-1 pt-1 text-xs text-ink-2">
          <Icon name="user" className="h-3 w-3 text-muted" />{reachText(p.kind, p.visits, p.conversions)}
          {p.conversions > 0 && <Icon name="check" className="h-3 w-3" label={CONV[p.kind].noun} />}
        </p>
      </div>
    </article>
  );
}
