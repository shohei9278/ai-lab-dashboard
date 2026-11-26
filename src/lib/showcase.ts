import { db, getSettings, type ProjectRow } from "./db";
import { CONV, ideaAuthorStats, projectTotals } from "./loop";
import { modelInfo } from "./models";
import { aimJudgeLine, judgeBasis, judgedByVisits } from "./judgeBasis";
import { MEMBERS, type Member } from "./officeShared";

// 概要ページ（/showcase）に載せるもの。来訪者が見るので、公開した・終わった実案件と、集計した数字だけを扱う

// 概要ページに載せる案件: 実案件のうち、公開したもの・終わったものだけ（まだ公開していないアイデアや下書きは出さない）
// 案件のカードと、概要ページのオフィス（showcaseOfficeSnapshot）の両方がこの条件を使う
export function showcaseProjectRows(): ProjectRow[] {
  return db().prepare("SELECT * FROM projects WHERE demo = 0 AND (public_version IS NOT NULL OR stage IN ('continued','killed')) ORDER BY id DESC").all() as ProjectRow[];
}

// 案件の画面写真: 公開した版の確認で撮ったもの。一度も公開していない案件（公開せずに終えたものなど）は、承認していない版なので出さない
// 自由にデザインしたLPは PC の一番上（なければスマホの1画面目）、動くツールは自動テストで撮ったもの
export function projectShot(p: Pick<ProjectRow, "id" | "public_version">): string | null {
  if (p.public_version === null) return null;
  const row = db().prepare("SELECT test FROM lp_versions WHERE project_id = ? AND version = ? ORDER BY id DESC LIMIT 1").get(p.id, p.public_version) as { test: string | null } | undefined;
  if (!row?.test) return null;
  try {
    const t = JSON.parse(row.test) as { kind?: string; pc?: string; shots?: string[]; screenshot?: string };
    const file = t.kind === "page" ? (t.pc ?? t.shots?.[0]) : t.screenshot;
    return file && /^[a-z0-9_-]+\.(png|jpg)$/i.test(file) ? file : null;
  } catch {
    return null;
  }
}

// 訪問と成果の書き方。率が 0.0% で並ばないよう「訪問◯人・まだ登録なし」のように書く
export function reachText(kind: ProjectRow["kind"], visits: number, conversions: number): string {
  const noun = CONV[kind].noun;
  if (!visits) return "まだ訪問なし";
  return conversions ? `訪問${visits}人・${noun}${conversions}件` : `訪問${visits}人・まだ${noun}なし`;
}

// 概要ページの写真の読み出し口（/api/showcase/shot/[id]）が返すファイル: 概要ページに載せる案件の、公開した版の写真だけ
export function showcaseShotFile(projectId: number): string | null {
  const p = showcaseProjectRows().find((x) => x.id === projectId);
  return p ? projectShot(p) : null;
}

export type ShowcaseProject = { id: number; title: string; kind: ProjectRow["kind"]; stage: ProjectRow["stage"]; author: Member | null; authorLabel: string; visits: number; conversions: number; shot: string | null; published: boolean };

export function showcaseProjects(): ShowcaseProject[] {
  return showcaseProjectRows().map((p) => {
    const t = projectTotals(p.id);
    const m = modelInfo(p.idea_model ?? p.model_id);
    const author = m.provider === "anthropic" || m.provider === "openai" || m.provider === "google" ? m.provider : null;
    return { id: p.id, title: p.title, kind: p.kind, stage: p.stage, author, authorLabel: m.label, visits: t.visits, conversions: t.signups, shot: projectShot(p) ? `/api/showcase/shot/${p.id}?v=${p.public_version}` : null, published: p.public_version !== null };
  });
}

// 社員3人の紹介: よくしている仕事（直近30日のAIの呼び出しの目的の上位）と、アイデアの採点の成績
export type MemberProfile = {
  id: Member; name: string; maker: boolean; jobs: string[];
  candidates: number; selected: number;
  fromOthers: number | null; fromSelf: number | null; givenToOthers: number | null;
  lean: "self" | "strict" | "even" | null;
};

const MAKER: Record<Member, string> = { anthropic: "Anthropic", openai: "OpenAI", google: "Google" };
export const memberMaker = (m: Member) => MAKER[m];

// 自分の案への点と他社からの点の差が、この幅を超えたら「甘め」「辛め」と書く（10点満点）
const LEAN_POINTS = 0.5;

export function memberProfiles(): MemberProfile[] {
  const loop = modelInfo(getSettings().loopModel).provider;
  const calls = db().prepare(
    "SELECT model_id, purpose, COUNT(*) AS n FROM ai_calls WHERE at >= datetime('now', '-30 days') AND error IS NULL GROUP BY model_id, purpose",
  ).all() as { model_id: string; purpose: string; n: number }[];
  const stats = ideaAuthorStats();
  return MEMBERS.map(({ id, name }) => {
    const jobs = new Map<string, number>();
    for (const c of calls) {
      if (c.model_id.endsWith("-api") || c.model_id.startsWith("gpt-image") || modelInfo(c.model_id).provider !== id) continue;
      const k = c.purpose.replace(/（.*?）/g, "");
      jobs.set(k, (jobs.get(k) ?? 0) + c.n);
    }
    const mine = stats.filter((a) => modelInfo(a.author).provider === id && a.candidates > 0);
    const candidates = mine.reduce((s, a) => s + a.candidates, 0);
    // 同じ会社の別のモデルがあるときは、出した案の数で重みを付けて平均する
    const avg = (pick: (a: (typeof mine)[number]) => number | null) => {
      const xs = mine.filter((a) => pick(a) !== null);
      const w = xs.reduce((s, a) => s + a.candidates, 0);
      return w ? xs.reduce((s, a) => s + pick(a)! * a.candidates, 0) / w : null;
    };
    const fromOthers = avg((a) => a.scoreFromOthers);
    const fromSelf = avg((a) => a.scoreFromSelf);
    const diff = fromOthers !== null && fromSelf !== null ? fromSelf - fromOthers : null;
    return {
      id, name, maker: loop === id,
      jobs: [...jobs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k),
      candidates, selected: mine.reduce((s, a) => s + a.selected, 0),
      fromOthers, fromSelf, givenToOthers: avg((a) => a.scoreGivenToOthers),
      lean: diff === null ? null : diff > LEAN_POINTS ? "self" : diff < -LEAN_POINTS ? "strict" : "even",
    };
  });
}

// ---- 分かったこと: 採用担当の人などが最初に読む、実験の要点。文は決めておき、数字はいまの記録から入れる ----
// 数字がまだないもの（評価をまだ流していない など）は出さない
export type Learning = { title: string; body: string };

export async function showcaseLearnings(): Promise<Learning[]> {
  const { autoPublishStats } = await import("./loop");
  const { recentPlans, planProgress } = await import("./plan");
  const { checkEvalOverview } = await import("./checkEval");
  const s = getSettings();
  const out: Learning[] = [];
  const projects = showcaseProjectRows().filter((p) => p.public_version !== null);
  const auto = autoPublishStats();
  if (projects.length) {
    out.push({
      title: "「作って公開する」までは、AIだけで回る",
      body: `公開した${projects.length}件のうち${auto.published}件は、人の承認なしでAIが公開しました。人があとから見て「出すべきでなかった」としたのは、確認した${auto.reviewed}件のうち${auto.bad}件です。`,
    });
  }
  const visits = projects.map((p) => projectTotals(p.id).visits);
  // 判断の目安は、ねらいごと（案件ごとに調整したものはそれ。judgeBasis.ts）
  // 育てる段階の前の「広がる」は、遊んだ人とシェアで判定するので、訪問の基準では数えない（提案箱 #107）
  const reached = projects.filter((p, i) => judgedByVisits(p) && visits[i] >= judgeBasis(p, s).visits).length;
  const total = visits.reduce((a, b) => a + b, 0);
  const plans = recentPlans(14).map((p) => planProgress(p).content.bottleneck);
  if (projects.length) {
    out.push({
      title: "ネックは、作ることより届けること",
      body: `訪問は累計${total}人で、判断の目安（ねらいごとに ${aimJudgeLine(s)}）のうち、訪問の基準に届いた案件は${reached}件です。${plans.length ? `直近${plans.length}日の朝の計画で、AIがネックに挙げたのは${plans.filter((b) => b === "reach").length}日が「届かない」でした。` : ""}SNSの自動投稿だけでは足りず、人の手で対象の人がいる場所に届ける段取りを入れています。`,
    });
  }
  // 1件も判定できなかった評価（APIのエラーなど）は、結果として出さない
  const ev = checkEvalOverview().latest.find((e) => e.ng.total + e.ok.total > 0);
  if (ev) {
    out.push({
      title: "AIのチェックは、正解の決まった例で確かめる",
      body: `人を通らずに公開するときの最後の砦は、AIの公開前チェックです。問題を1つだけ入れたページと問題のないページ（計${ev.ng.total + ev.ok.total + ev.failed}件）で確かめ、${modelInfo(ev.run.model_id).label}は問題のあるページ${ev.ng.caught}/${ev.ng.total}件を止め、問題のないページ${ev.ok.passed}/${ev.ok.total}件を通しました。${ev.failed ? `ほかに${ev.failed}件は、答えが取れず判定できませんでした。` : ""}`,
    });
  }
  return out;
}

// クラウドの Claude Code（ルーティン）が回している数（ポートフォリオの「自分で直して、自分で作る」に出す）
// ツール: ルーティンが作って入れたツールの案件の数・そのうち公開した数・人の承認なしで公開した数
// 改善: 提案箱から Claude Code に頼んだ数・できた PR がマージされた数
// 見直し: コードの見直しのルーティンが提案箱に入れた数・そのうち Claude Code に頼んだ数・PR がマージされた数
export function showcaseRoutineStats(): { tools: number; published: number; autoPublished: number; asked: number; merged: number; reviewed: number; reviewAsked: number; reviewMerged: number } {
  const t = db().prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(p.published_at IS NOT NULL), 0) AS pub, COALESCE(SUM(p.published_at IS NOT NULL AND p.auto_published = 1), 0) AS auto FROM projects p
    WHERE p.demo = 0 AND EXISTS (SELECT 1 FROM events e WHERE e.project_id = p.id AND e.kind = 'dev-upload' AND e.message LIKE '%ルーティン%')`).get() as { n: number; pub: number; auto: number };
  const f = db().prepare("SELECT COUNT(*) AS asked, COALESCE(SUM(ai_fix_pr_state = 'merged'), 0) AS merged FROM plan_requests WHERE ai_fix_at IS NOT NULL").get() as { asked: number; merged: number };
  const r = db().prepare("SELECT COUNT(*) AS n, COALESCE(SUM(ai_fix_at IS NOT NULL), 0) AS asked, COALESCE(SUM(ai_fix_pr_state = 'merged'), 0) AS merged FROM plan_requests WHERE source = 'review'").get() as { n: number; asked: number; merged: number };
  return { tools: t.n, published: t.pub, autoPublished: t.auto, asked: f.asked, merged: f.merged, reviewed: r.n, reviewAsked: r.asked, reviewMerged: r.merged };
}
