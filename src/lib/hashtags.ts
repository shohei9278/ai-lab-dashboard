import { db } from "./db";

// 投稿のハッシュタグ: 見つけてもらうために付ける（宣伝っぽさを抑えるため、前は「使っても1つまで」にしていた）
// - 数は投稿先ごとに決める（snsApi.ts の tagMax・plainTagMax。Threads は1投稿にトピックが1つ）
// - 対象の人が実際に検索・フォローしていそうな言葉と、ツールの種類の言葉を混ぜる。作った言葉は付けない
// - ダッシュボードが集めた「話題の投稿」で実際に使われているタグを数えて、候補としてAIに渡す

// 本文からハッシュタグを取り出す（# と ＃ のどちらも。2〜30文字。同じものは1つ）
export function extractTags(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/[#＃]([\p{L}\p{N}_ー・]{2,30})/gu)) out.add(`#${m[1]}`);
  return [...out];
}

// 話題の投稿（直近90日・読めたもの）で使われているハッシュタグを、使われた投稿の数（同じなら、いいねの合計）の多い順に返す
export function popularTags(limit = 15): string[] {
  const rows = db().prepare("SELECT text, COALESCE(likes, 0) AS likes FROM viral_posts WHERE status = 'ok' AND text IS NOT NULL AND at >= datetime('now', '-90 days')").all() as { text: string; likes: number }[];
  const count = new Map<string, { n: number; likes: number }>();
  for (const r of rows) {
    for (const t of extractTags(r.text)) {
      const c = count.get(t) ?? { n: 0, likes: 0 };
      count.set(t, { n: c.n + 1, likes: c.likes + r.likes });
    }
  }
  return [...count.entries()].sort((a, b) => b[1].n - a[1].n || b[1].likes - a[1].likes).slice(0, limit).map(([t]) => t);
}

// 下書きを書くAIに渡す、ハッシュタグの決まり（max: 付けてよい数）
export function tagRule(max: number): string {
  if (max <= 0) return "ハッシュタグは付けない";
  return `ハッシュタグは${max}つまで（見つけてもらうためのもの。付けなくてもよい）。対象の人が実際に検索・フォローしていそうな言葉（例: #ハンドメイド作家）や、ツールの種類の言葉（例: #診断メーカー #無料ツール）から選ぶ。作った言葉・長すぎる言葉・誰も使っていなさそうなタグは付けない。本文の最後にまとめて付け、文字数に含める`;
}

// 候補として渡す、実際に使われているタグの一覧（なければ空）
export function tagHints(): string {
  const tags = popularTags();
  return tags.length ? `\n\n参考: 話題の投稿で実際に使われているハッシュタグ（多い順。対象や中身に合うものだけ使い、合わなければ使わない）: ${tags.join(" ")}` : "";
}
