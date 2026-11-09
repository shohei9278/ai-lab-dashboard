import { callJson, isObj } from "./ai";
import { db, getSettings } from "./db";
import { logEvent } from "./loop";
import { X_READ_COST_USD, searchAcross } from "./xPost";

// 「こういうの欲しい」の声
// 週1回、X で「〇〇できるアプリ欲しい」「誰か作って」などの投稿を探し、AIがプロダクトの需要だけを残す。
// いいねの数は「自分も欲しい」人の数の目安。アイデア出しに渡し、声から生まれた案件には元の声を残す。
// 投稿者への返信・メンション・引用はしない（拾うだけ）

export type UserWant = {
  id: number; at: string; tweet_id: string; url: string; text: string; posted_at: string | null;
  likes: number | null; reposts: number | null; bookmarks: number | null; replies: number | null;
  status: "ok" | "rejected"; who: string | null; problem: string | null; note: string | null;
};

// 「アプリが欲しい」と言葉にしていなくても、アプリで解決できそうな困りごとも読む
export const WANT_QUERIES = [
  "(欲しい OR ほしい OR ないかな OR ないのかな OR あったらいいのに OR 誰か作って OR 作ってほしい) (アプリ OR ツール OR サービス OR サイト) -is:retweet -is:reply lang:ja",
  "(面倒 OR めんどくさい OR 不便 OR 手間 OR どうにかならない) (管理 OR 記録 OR 計算 OR 予約 OR 手続き OR 共有 OR 入力) -is:retweet -is:reply lang:ja",
  "(おすすめのアプリ OR いいアプリ OR 便利なツール OR いいツール) (ない OR ありますか OR 教えて OR 探してる) -is:retweet -is:reply lang:ja",
];

export function listWants(): (UserWant & { project_id: number | null; project_title: string | null })[] {
  return db().prepare(
    `SELECT w.*, p.id AS project_id, p.title AS project_title FROM user_wants w LEFT JOIN projects p ON p.want_id = w.id
     WHERE w.status = 'ok' GROUP BY w.id ORDER BY w.id DESC LIMIT 100`,
  ).all() as (UserWant & { project_id: number | null; project_title: string | null })[];
}

export function getWant(id: number): UserWant | undefined {
  return db().prepare("SELECT * FROM user_wants WHERE id = ?").get(id) as UserWant | undefined;
}

export function deleteWant(id: number) {
  db().prepare("UPDATE user_wants SET status = 'rejected', note = '運営者が外しました' WHERE id = ?").run(id);
}

// 直近7日の投稿を読み、いいね5以上のものをAIに選り分けさせる
export async function searchWants(): Promise<{ read: number; added: number }> {
  const s = getSettings();
  const pages = Math.round(s.wantsSearchCount / 100);
  if (pages <= 0) return { read: 0, added: 0 };
  let read = 0;
  try {
    const all: { id: string; text: string; created_at?: string; likes: number; reposts: number; bookmarks: number; replies: number }[] = [];
    for (const p of await searchAcross(WANT_QUERIES, pages, (n) => { read += n; })) {
      const m = p.public_metrics;
      if (m) all.push({ id: p.id, text: p.text, created_at: p.created_at, likes: m.like_count, reposts: m.retweet_count, bookmarks: m.bookmark_count ?? 0, replies: m.reply_count });
    }
    const known = new Set((db().prepare("SELECT tweet_id FROM user_wants").all() as { tweet_id: string }[]).map((x) => x.tweet_id));
    const cands = all.filter((x) => x.likes >= 5 && !known.has(x.id)).sort((a, b) => b.likes - a.likes).slice(0, 40);
    if (!cands.length) {
      logEvent(null, "system", "wants-search", `Xで「欲しい」の声を検索: ${read}件を読み、新しい声はありませんでした`);
      return { read, added: 0 };
    }
    const out = await callJson<{ items: { n: number; keep: boolean; who: string; problem: string; note: string }[] }>({
      purpose: "「欲しい」の声の選別",
      system: `あなたはプロダクトのリサーチャーです。Xの投稿から、個人や小さなチームが作れるプロダクト（アプリ・Webサービス・ツール・デジタル商品など）への需要だけを選びます。
残すもの: 「〇〇できるアプリが欲しい」「〇〇を管理するツールないかな」のように、困りごとや欲しい機能が読み取れるもの。製品の名前が出ていなくても、「毎回〇〇の計算が面倒」のように、アプリやツールで解決できそうな具体的な困りごとも残す
外すもの: ただの愚痴で解決したいことが読み取れないもの、物を買いたい話（服・家電など）、特定の会社の既存サービスへの不満や要望だけのもの、冗談・大喜利、宣伝、政治・事件の話、医療・法律・お金の助言が必要なもの、誰かを攻撃する話
残すものは、who（どんな人か。投稿から読み取れる範囲で短く。個人を特定する情報は書かない）と problem（何に困っていて、何が欲しいか。1文）を書く。外すものは note に理由を短く書く。
形式: {"items":[{"n":番号,"keep":true,"who":"","problem":"","note":""}]}`,
      user: cands.map((c, i) => `【${i + 1}】いいね${c.likes}・ブックマーク${c.bookmarks}・返信${c.replies}\n${c.text.slice(0, 400)}`).join("\n\n"),
      validate: (v): v is { items: { n: number; keep: boolean; who: string; problem: string; note: string }[] } => isObj(v) && Array.isArray(v.items),
    });
    const insert = db().prepare(
      `INSERT OR IGNORE INTO user_wants (tweet_id, url, text, posted_at, likes, reposts, bookmarks, replies, status, who, problem, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    let added = 0;
    for (const it of out.items) {
      const c = cands[Number(it.n) - 1];
      if (!c) continue;
      const keep = it.keep === true && typeof it.problem === "string" && it.problem.trim() !== "";
      insert.run(c.id, `https://x.com/i/web/status/${c.id}`, c.text.slice(0, 1000), c.created_at ? c.created_at.slice(0, 19).replace("T", " ") : null,
        c.likes, c.reposts, c.bookmarks, c.replies, keep ? "ok" : "rejected",
        keep ? String(it.who ?? "").slice(0, 100) : null, keep ? it.problem.slice(0, 300) : null, typeof it.note === "string" ? it.note.slice(0, 200) : null);
      if (keep) added++;
    }
    logEvent(null, "system", "wants-search", `Xで「欲しい」の声を検索: ${read}件を読み、${cands.length}件をAIが見て、${added}件を残しました`);
    return { read, added };
  } finally {
    if (read) db().prepare("INSERT INTO ai_calls (project_id, purpose, model_id, input_tokens, output_tokens, cost_usd, error) VALUES (NULL, ?, 'x-api', 0, 0, ?, NULL)").run("Xで「欲しい」の声を検索", read * X_READ_COST_USD);
  }
}

// アイデア出しに渡す声（まだ案件になっていないもの・直近60日・いいねの多い順）
export function wantsForIdeas(limit = 12): UserWant[] {
  return db().prepare(
    `SELECT w.* FROM user_wants w WHERE w.status = 'ok' AND w.at >= datetime('now', '-60 days')
     AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.want_id = w.id) ORDER BY w.likes DESC LIMIT ?`,
  ).all(limit) as UserWant[];
}

export function wantsText(): string {
  const list = wantsForIdeas();
  if (!list.length) return "";
  return `\n\nXで見つけた「こういうの欲しい」の声（いいねは「自分も欲しい」人の数の目安。この困りごとから案を作ってよい。そのときは want_id に声の番号を書く。投稿者への返信・メンション・引用を届け方にしない）:\n${list.map((w) => `- 声${w.id}（いいね${w.likes ?? 0}）: ${w.who ? `${w.who}が、` : ""}${w.problem}`).join("\n")}`;
}
