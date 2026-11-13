import { db, getSettings, type ProjectRow } from "./db";
import { CONV, ideaAuthorStats, projectTotals } from "./loop";
import { modelInfo } from "./models";
import { MEMBERS, type Member } from "./officeShared";

// 概要ページ（/showcase）に載せるもの。来訪者が見るので、公開した・終わった実案件と、集計した数字だけを扱う

// 概要ページに載せる案件: 実案件のうち、公開したもの・終わったものだけ（まだ公開していないアイデアや下書きは出さない）
export function showcaseProjectRows(): ProjectRow[] {
  return db().prepare("SELECT * FROM projects WHERE demo = 0 AND (public_version IS NOT NULL OR stage IN ('continued','killed')) ORDER BY id DESC").all() as ProjectRow[];
}

// 案件の画面写真: 公開した版（なければ最新の版）の確認で撮ったもの。
// 自由にデザインしたLPは PC の一番上（なければスマホの1画面目）、動くツールは自動テストで撮ったもの
export function projectShot(p: Pick<ProjectRow, "id" | "public_version" | "lp_version">): string | null {
  const v = p.public_version ?? p.lp_version;
  const row = db().prepare("SELECT test FROM lp_versions WHERE project_id = ? AND version = ? ORDER BY id DESC LIMIT 1").get(p.id, v) as { test: string | null } | undefined;
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

export type ShowcaseProject = { id: number; title: string; kind: ProjectRow["kind"]; stage: ProjectRow["stage"]; author: Member | null; authorLabel: string; visits: number; conversions: number; shot: string | null; published: boolean };

export function showcaseProjects(): ShowcaseProject[] {
  return showcaseProjectRows().map((p) => {
    const t = projectTotals(p.id);
    const m = modelInfo(p.idea_model ?? p.model_id);
    const author = m.provider === "anthropic" || m.provider === "openai" || m.provider === "google" ? m.provider : null;
    return { id: p.id, title: p.title, kind: p.kind, stage: p.stage, author, authorLabel: m.label, visits: t.visits, conversions: t.signups, shot: projectShot(p), published: p.public_version !== null };
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
