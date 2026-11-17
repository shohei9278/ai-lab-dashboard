import { isObj, isStr } from "./ai";
import { db } from "./db";

// 第2段（外部の API を許す）の入口: アイデアに書かれた「使いたい API」（api_wish）を数える
// 今は通信を止めたまま。どの API を、どれだけの案が、何のために欲しがったかを見て、許すかを人が決める

export type ApiWish = { name: string; purpose: string; key: boolean; sends: string };
export type ApiWishSummary = { name: string; count: number; purposes: string[]; key: boolean; sends: string[]; titles: string[]; lastAt: string };

// アイデアの api_wish を、決めた形にそろえる（名前がないものは数えない）
export function apiWishOf(v: unknown): ApiWish | null {
  if (!isObj(v) || !isStr(v.name) || !v.name.trim()) return null;
  return {
    name: v.name.trim().slice(0, 60),
    purpose: isStr(v.purpose) ? v.purpose.trim().slice(0, 200) : "",
    key: v.key === true,
    sends: isStr(v.sends) ? v.sends.trim().slice(0, 200) : "",
  };
}

// 直近 days 日のアイデアの候補（見るだけで出したものは除く）から、API の名前ごとにまとめる。多い順
// 名前は大文字・小文字と前後の空白をそろえて同じものとみなす（表示には、最初に出た書き方を使う）
export function apiWishSummary(days = 30): ApiWishSummary[] {
  const rows = db().prepare("SELECT at, title, payload FROM idea_candidates WHERE practice = 0 AND at >= datetime('now', ?) ORDER BY id")
    .all(`-${days} days`) as { at: string; title: string; payload: string }[];
  const by = new Map<string, ApiWishSummary>();
  for (const r of rows) {
    let wish: ApiWish | null = null;
    try { wish = apiWishOf((JSON.parse(r.payload) as { api_wish?: unknown }).api_wish); } catch { continue; }
    if (!wish) continue;
    const k = wish.name.toLowerCase().replace(/\s+/g, " ");
    const s = by.get(k) ?? { name: wish.name, count: 0, purposes: [], key: false, sends: [], titles: [], lastAt: r.at };
    s.count++;
    if (wish.purpose && s.purposes.length < 3 && !s.purposes.includes(wish.purpose)) s.purposes.push(wish.purpose);
    if (wish.sends && s.sends.length < 2 && !s.sends.includes(wish.sends)) s.sends.push(wish.sends);
    if (s.titles.length < 5 && !s.titles.includes(r.title)) s.titles.push(r.title);
    s.key ||= wish.key;
    s.lastAt = r.at;
    by.set(k, s);
  }
  return [...by.values()].sort((a, b) => b.count - a.count || b.lastAt.localeCompare(a.lastAt));
}
