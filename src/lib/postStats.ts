import { callJson, isObj } from "./ai";
import { db } from "./db";
import { hasKey } from "./models";

// 「効いた手」の集計: これまでのAIの投稿（宣伝・普通の投稿）を、場所・宣伝か普通か・時間帯・切り口の型ごとにまとめる
// 毎日の計画で、7日より前の結果も踏まえられるように渡す。件数が増えるほど確かになる

export const ANGLE_TYPES = {
  empathy: "困りごとへの共感",
  result: "結果・完成見本を見せる",
  howto: "使い方の具体例",
  question: "問いかけ",
  story: "作った理由・裏側",
  log: "実験の記録",
  tip: "役立つ小ネタ",
  freebie: "すぐ使える文例・チェックリスト",
  other: "その他",
} as const;
export type AngleType = keyof typeof ANGLE_TYPES;
export const isAngleType = (v: unknown): v is AngleType => typeof v === "string" && v in ANGLE_TYPES;

const BANDS: [string, number, number][] = [["朝（8〜11時）", 8, 11], ["昼（11〜15時）", 11, 15], ["夕方（15〜18時）", 15, 18], ["夜（18〜22時）", 18, 22]];
const PLATFORM_LABEL: Record<string, string> = { x: "X", threads: "Threads", bluesky: "Bluesky" };

type Fact = { platform: string; kind: "promo" | "plain"; type: string | null; at: string; visits: number | null; conversions: number | null; reaction: number | null };

function facts(): Fact[] {
  const a = db().prepare(
    `SELECT platform, 'promo' AS kind, angle_type AS type, posted_at AS at, visits, conversions,
       CASE WHEN reactions_at IS NULL THEN NULL ELSE COALESCE(likes, 0) + COALESCE(replies, 0) + COALESCE(reposts, 0) END AS reaction
     FROM sns_posts WHERE status = 'posted' AND author = 'ai' AND post_url IS NOT NULL`,
  ).all() as Fact[];
  const b = db().prepare(
    `SELECT platform, 'plain' AS kind, angle_type AS type, done_at AS at, NULL AS visits, NULL AS conversions,
       CASE WHEN reactions_at IS NULL THEN NULL ELSE COALESCE(likes, 0) + COALESCE(replies, 0) + COALESCE(reposts, 0) END AS reaction
     FROM plan_tasks WHERE kind = 'plain' AND status = 'done' AND result_url IS NOT NULL`,
  ).all() as Fact[];
  return [...a, ...b];
}

const jstHour = (at: string) => Number(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Tokyo", hour: "numeric", hourCycle: "h23" }).format(new Date(at.replace(" ", "T") + "Z")));

export type StatRow = { label: string; n: number; promo: number; avgVisits: number | null; conversions: number; reacted: number; avgReaction: number | null };

function summarize(label: string, list: Fact[]): StatRow {
  const promo = list.filter((f) => f.kind === "promo");
  const reacted = list.filter((f) => f.reaction !== null);
  return {
    label, n: list.length, promo: promo.length,
    avgVisits: promo.length ? promo.reduce((s, f) => s + (f.visits ?? 0), 0) / promo.length : null,
    conversions: promo.reduce((s, f) => s + (f.conversions ?? 0), 0),
    reacted: reacted.length,
    avgReaction: reacted.length ? reacted.reduce((s, f) => s + (f.reaction ?? 0), 0) / reacted.length : null,
  };
}

function groupBy(list: Fact[], key: (f: Fact) => string | null): StatRow[] {
  const m = new Map<string, Fact[]>();
  for (const f of list) {
    const k = key(f);
    if (k) m.set(k, [...(m.get(k) ?? []), f]);
  }
  return [...m].map(([k, v]) => summarize(k, v)).sort((a, b) => b.n - a.n);
}

export function postStats() {
  const all = facts();
  return {
    total: all.length,
    byPlace: groupBy(all, (f) => `${PLATFORM_LABEL[f.platform] ?? f.platform}・${f.kind === "promo" ? "宣伝" : "普通の投稿"}`),
    byTime: groupBy(all, (f) => BANDS.find(([, a, b]) => { const h = jstHour(f.at); return h >= a && h < b; })?.[0] ?? "そのほかの時間"),
    byType: groupBy(all, (f) => (f.type && isAngleType(f.type) ? ANGLE_TYPES[f.type] : "未分類")),
  };
}

const fmt = (r: StatRow) =>
  `- ${r.label}: ${r.n}件${r.promo ? `・宣伝からの訪問 平均${r.avgVisits!.toFixed(1)}人（登録・利用 計${r.conversions}）` : ""}${r.reacted ? `・反応（いいね＋返信＋リポスト）平均${r.avgReaction!.toFixed(1)}（${r.reacted}件で集計）` : "・反応はまだ未集計"}`;

// 毎日の計画のAIに渡す文
export function postStatsText(): string {
  const s = postStats();
  if (!s.total) return "";
  return `効いた手の集計（これまでの全投稿。件数が少ない組み合わせは偶然の可能性が高い）:
場所と種類:
${s.byPlace.map(fmt).join("\n")}
時間帯（日本時間）:
${s.byTime.map(fmt).join("\n")}
切り口の型:
${s.byType.map(fmt).join("\n")}`;
}

// 型がまだ付いていない投稿（計画を使う前の投稿・決まった間隔の自動投稿）に、AIが型を付ける。安いモデルで、1回に60件まで
export async function classifyUntyped(ask: typeof callJson = callJson): Promise<number> {
  // 普通の投稿は、番号が重ならないよう p を付けて区別する
  const rows = [
    ...(db().prepare("SELECT id, angle, text FROM sns_posts WHERE status = 'posted' AND author = 'ai' AND angle_type IS NULL ORDER BY id DESC LIMIT 50").all() as { id: number; angle: string | null; text: string }[])
      .map((r) => ({ key: String(r.id), table: "sns_posts", ...r })),
    ...(db().prepare("SELECT id, angle, result AS text FROM plan_tasks WHERE kind = 'plain' AND status = 'done' AND angle_type IS NULL ORDER BY id DESC LIMIT 10").all() as { id: number; angle: string | null; text: string }[])
      .map((r) => ({ key: `p${r.id}`, table: "plan_tasks", ...r })),
  ];
  if (!rows.length) return 0;
  const out = await ask<{ types: { id: string; type: string }[] }>({
    purpose: "投稿の切り口の分類",
    modelId: hasKey("anthropic") ? "claude-haiku-5-5" : undefined,
    system: `SNSの投稿を、切り口の型に分けます。型: ${Object.entries(ANGLE_TYPES).map(([k, v]) => `${k}（${v}）`).join(" / ")}
形式: {"types":[{"id":"【】の中の番号","type":"型"}]}`,
    user: rows.map((r) => `【${r.key}】切り口: ${r.angle ?? "—"} / 本文: ${r.text.slice(0, 140).replace(/\n/g, " ")}`).join("\n"),
    validate: (v): v is { types: { id: string; type: string }[] } => isObj(v) && Array.isArray(v.types),
  });
  let n = 0;
  for (const t of out.types) {
    const r = rows.find((x) => x.key === String(t.id));
    if (!r) continue;
    n += db().prepare(`UPDATE ${r.table} SET angle_type = ? WHERE id = ? AND angle_type IS NULL`).run(isAngleType(t.type) ? t.type : "other", r.id).changes;
  }
  return n;
}

// ---- AIだけで出した投稿を、人があとから確かめる ----

export type AiPost = {
  table: "sns_posts" | "plan_tasks"; id: number; platform: string; kind: "promo" | "plain"; text: string; url: string | null; at: string;
  project_id: number | null; human_review: string | null; human_note: string | null;
  likes: number | null; replies: number | null; reposts: number | null; reactions_at: string | null;
};

// 直近 days 日のAIの投稿（宣伝・普通の投稿）。新しい順
export function recentAiPosts(days = 3): AiPost[] {
  const a = db().prepare(
    `SELECT 'sns_posts' AS "table", id, platform, 'promo' AS kind, text, post_url AS url, posted_at AS at, project_id, human_review, human_note, likes, replies, reposts, reactions_at
     FROM sns_posts WHERE status = 'posted' AND author = 'ai' AND post_url IS NOT NULL AND posted_at >= datetime('now', ?)`,
  ).all(`-${days} days`) as AiPost[];
  const b = db().prepare(
    `SELECT 'plan_tasks' AS "table", id, platform, 'plain' AS kind, result AS text, result_url AS url, done_at AS at, NULL AS project_id, human_review, human_note, likes, replies, reposts, reactions_at
     FROM plan_tasks WHERE kind = 'plain' AND status = 'done' AND result_url IS NOT NULL AND done_at >= datetime('now', ?)`,
  ).all(`-${days} days`) as AiPost[];
  return [...a, ...b].sort((x, y) => y.at.localeCompare(x.at));
}

export function unreviewedPostCount(days = 3): number {
  return recentAiPosts(days).filter((p) => !p.human_review).length;
}

export function reviewPost(table: AiPost["table"], id: number, verdict: "ok" | "bad", note: string) {
  if (table !== "sns_posts" && table !== "plan_tasks") throw new Error("投稿が分かりません");
  const n = db().prepare(`UPDATE ${table} SET human_review = ?, human_note = ? WHERE id = ?`).run(verdict, note.trim().slice(0, 300) || null, id).changes;
  if (!n) throw new Error("投稿が見つかりません");
}

// 人が「ダメ」とした投稿（次の計画・投稿を書くAIに、同じ書き方を避けさせる）
export function badPostsText(kind?: "promo" | "plain"): string {
  const rows = [
    ...(kind !== "plain" ? db().prepare("SELECT text, human_note FROM sns_posts WHERE human_review = 'bad' ORDER BY id DESC LIMIT 10").all() as { text: string; human_note: string | null }[] : []),
    ...(kind !== "promo" ? db().prepare("SELECT result AS text, human_note FROM plan_tasks WHERE human_review = 'bad' ORDER BY id DESC LIMIT 10").all() as { text: string; human_note: string | null }[] : []),
  ];
  if (!rows.length) return "";
  return `\n\n運営者が「出すべきでなかった」と判断した投稿（同じ書き方・同じ内容を避ける）:\n${rows.map((r) => `- 「${r.text.slice(0, 80).replace(/\n/g, " ")}」${r.human_note ? `→ 理由: ${r.human_note}` : ""}`).join("\n")}`;
}
