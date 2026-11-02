import { callJson, isObj, isStr } from "./ai";
import { db, getSettings, type ProjectRow } from "./db";
import { CONV, KIND_LABEL, STAGE_LABEL, logEvent, projectTotals, type Lp } from "./loop";
import { publicUrl } from "./publish";
import { seasonalContext } from "./season";
import { trendsText } from "./trends";

// 集客の作戦: フォロワーがほとんどいないアカウントで、どこから人を呼ぶかをAIに考えさせる
// 実行するのはあなた（AIは投稿しない）。結果は投稿ごとの専用リンクで測る

export const SNS_PLATFORMS = {
  x: "X",
  threads: "Threads",
  instagram: "Instagram",
  note: "note",
  facebook: "Facebook",
  line: "LINE（オープンチャットなど）",
  community: "コミュニティ・掲示板",
  other: "その他",
} as const;
export type SnsPlatform = keyof typeof SNS_PLATFORMS;

export type GrowthPlan = {
  summary: string;
  profile: { bio: string; pinned: string };
  channels: { name: string; platform: string; where: string; why: string; how: string; projects: number[]; effort: string; risk: string; measure: string }[];
  firstWeek: { task: string; platform: string; projectId: number | null }[];
  postPatterns: { name: string; example: string }[];
  avoid: string[];
};
export type GrowthRow = { id: number; created_at: string; model_id: string; input: string | null; content: string; done: string };

const isPlan = (v: unknown): v is GrowthPlan =>
  isObj(v) && isStr(v.summary) && isObj(v.profile) && Array.isArray(v.channels) && Array.isArray(v.firstWeek) && Array.isArray(v.postPatterns) && Array.isArray(v.avoid);

export async function createGrowthPlan(input: { followers: number | null; wish: string }): Promise<number> {
  const s = getSettings();
  const projects = db().prepare("SELECT * FROM projects WHERE demo = 0 AND public_slug IS NOT NULL AND stage NOT IN ('killed','rejected')").all() as ProjectRow[];
  if (!projects.length) throw new Error("公開中の案件がありません");
  const lines = projects.map((p) => {
    const lp = p.lp ? (JSON.parse(p.lp) as Lp) : null;
    const t = projectTotals(p.id);
    return `- #${p.id} ${p.title}（${KIND_LABEL[p.kind]}・${STAGE_LABEL[p.stage]}）対象: ${p.target} / 困りごと・動機: ${p.problem} / 見出し: ${lp?.headline ?? ""} / URL: ${publicUrl(p.id) ?? "未設定"} / ここまで: 訪問${t.visits} ${CONV[p.kind].noun}${t.signups}`;
  });
  const posts = (db().prepare("SELECT s.platform, s.text, s.visits, s.conversions, p.title FROM sns_posts s JOIN projects p ON p.id = s.project_id WHERE s.status = 'posted' ORDER BY s.posted_at DESC LIMIT 20").all() as { platform: string; text: string; visits: number; conversions: number; title: string }[])
    .map((x) => `- [${x.platform}] ${x.title}: 「${x.text.slice(0, 60)}…」訪問${x.visits} 成果${x.conversions}`);
  const previous = db().prepare("SELECT content, done FROM growth_plans ORDER BY id DESC LIMIT 1").get() as { content: string; done: string } | undefined;
  const prevText = previous
    ? (() => {
        const p = JSON.parse(previous.content) as GrowthPlan;
        const done = new Set(JSON.parse(previous.done) as number[]);
        return p.firstWeek.map((t, i) => `- ${done.has(i) ? "済" : "未"}: ${t.task}`).join("\n");
      })()
    : "（なし）";

  const plan = await callJson<GrowthPlan>({
    purpose: "集客の作戦",
    system: `あなたは、個人が運営する小さなWebサービスの集客担当です。X のアカウント（@${s.snsAccount || "未設定"}）はできたばかりで、フォロワーはほとんどいません。広告は使わず、まずどこから人を呼ぶかの作戦を立てます。
考え方:
- フォロワー0のアカウントの投稿は、そのままではほとんど届かない。すでに対象の人が集まっている場所（検索・ハッシュタグ・コミュニティ・まとめ・関連する話題への返信など）から入る道を、案件ごとの対象者に合わせて具体的に考える
- 動くツールは「その場で使える・結果をシェアしたくなる」ので広まりやすい。事前登録LPは、困りごとを持つ人が集まる場所で、押し付けにならない形で知ってもらう
- 1人で週に数時間でできる量にする。効果が大きく手間が小さい順に並べる
- 効果は、ダッシュボードの案件の画面で「投稿先ごとに作る専用リンク（URLの最後に ?s=… が付く）」で測る。UTM などほかの仕組みは使わない（measure にもそう書く）
- 時期の話題に乗れるなら使う
守ること:
- スパム・自作自演・なりすまし・複数アカウントでの水増し・無関係な人への大量の返信・規約違反は提案しない。運営者が名乗った上での紹介にする
- 各サービスの規約や仕様は変わるので、断定できないことは「確認が必要」と書く
- 数字の効果を約束しない
- 前回の作戦で済んだこと・まだのことを踏まえる
出すもの:
- summary: 最初の方針を3行ほどで
- profile: X のプロフィール文（160文字以内。動くツールと準備中のサービスの事前登録の両方があることが自然に伝わるように）と、固定する投稿の文
- channels: 人を呼ぶ場所を3〜6個。platform は ${Object.keys(SNS_PLATFORMS).join(" / ")} のどれか。projects は向いている案件の番号
- firstWeek: 今週やること 5〜8個（具体的な行動。projectId は対象の案件の番号か null）
- postPatterns: 届きやすい投稿の型を3つ（例文つき。URLは書かない）
- avoid: やってはいけないこと
形式: {"summary":"","profile":{"bio":"","pinned":""},"channels":[{"name":"","platform":"x","where":"具体的な場所","why":"","how":"具体的なやり方","projects":[1],"effort":"小|中|大","risk":"気をつけること","measure":"何で効果を測るか"}],"firstWeek":[{"task":"","platform":"x","projectId":null}],"postPatterns":[{"name":"","example":""}],"avoid":[""]}`,
    user: `公開中の案件:\n${lines.join("\n")}\n\n今のフォロワー数: ${input.followers ?? "不明（ほぼ0）"}\n運営者の希望: ${input.wish || "（特になし）"}\n\n${seasonalContext(new Date(), s.trendNotes)}\n\n${trendsText()}\n\nこれまでの投稿と反応:\n${posts.join("\n") || "（まだなし）"}\n\n前回の作戦の「今週やること」:\n${prevText}`,
    validate: isPlan,
  });
  const id = Number(
    db().prepare("INSERT INTO growth_plans (model_id, input, content) VALUES (?, ?, ?)").run(s.loopModel, JSON.stringify(input), JSON.stringify(plan)).lastInsertRowid,
  );
  logEvent(null, "ai", "growth", "集客の作戦を作りました");
  return id;
}

export function listGrowthPlans(): GrowthRow[] {
  return db().prepare("SELECT * FROM growth_plans ORDER BY id DESC").all() as GrowthRow[];
}

export function toggleGrowthTask(id: number, index: number, done: boolean) {
  const row = db().prepare("SELECT done FROM growth_plans WHERE id = ?").get(id) as { done: string } | undefined;
  if (!row) throw new Error("作戦が見つかりません");
  const set = new Set(JSON.parse(row.done) as number[]);
  if (done) set.add(index); else set.delete(index);
  db().prepare("UPDATE growth_plans SET done = ? WHERE id = ?").run(JSON.stringify([...set].sort((a, b) => a - b)), id);
}
