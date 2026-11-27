// 訪問の記録（/api/track）を lp_views に保存する手順（Supabase に触る部分は store として受け取り、テストで差し替えられるようにする。PR #218 の ai-review の指摘）
import type { InApp } from "./inApp";

type Result = { error: { message: string } | null };
export type ViewKey = { slug: string; version: number; visitor_id: string };
export type ViewStore = {
  // 同じ人・同じ版・同じ日の2回目以降は捨てる（日ごとの重複排除）
  insert(row: Record<string, unknown>): Promise<Result>;
  // 今日の記録の inapp を、まだ分かっていない（NULL）・アプリの外（""）のときだけ埋める。
  // source が文字列・null のときは、その投稿に帰属する記録だけ（undefined なら source 列がないので見ない）
  fillInApp(key: ViewKey, inapp: InApp | "", source: string | null | undefined): Promise<Result>;
};

// 任意の列（Supabase にあとから足す列）。足す前でも、その列なしで訪問は記録する
const OPTIONAL = ["inapp", "source"] as const;

export async function recordView(store: ViewStore, row: ViewKey & Record<string, unknown>, source: string | null, inapp: InApp | "" | null): Promise<Result> {
  const extra: Record<string, unknown> = { ...(source ? { source } : {}), ...(inapp !== null ? { inapp } : {}) };
  const dropped = new Set<string>();
  // 欠けた列のエラーは1つずつ、どの順で返ってきても返ってきた列を外して記録し直す。外せる列がなくなったら止める
  for (;;) {
    const { error } = await store.insert({ ...row, ...extra });
    if (!error) break;
    const missing = OPTIONAL.find((c) => c in extra && new RegExp(`\\b${c}\\b`).test(error.message));
    if (!missing) return { error };
    delete extra[missing];
    dropped.add(missing);
  }
  // 同じ日の再訪で、前の記録がアプリの中かを分かっていない・アプリの外だったら、今回の判定で埋める（投稿への帰属は最初の記録のまま変えない）
  if ("inapp" in extra && inapp !== null) {
    // 訪問は記録できているので、埋められなくても成功として返す
    const key = { slug: row.slug, version: row.version, visitor_id: row.visitor_id };
    const src = dropped.has("source") ? undefined : source;
    const filled = await store.fillInApp(key, inapp, src).catch(() => null);
    // 目印のない訪問は source を送らないので、source 列がないことは更新のときに分かる。そのときだけ source の条件を外してやり直す（列がなければ帰属もないので、書き換える記録は変わらない。PR #218 の ai-review の指摘）
    if (src !== undefined && filled?.error && /\bsource\b/.test(filled.error.message)) await store.fillInApp(key, inapp, undefined).catch(() => null);
  }
  return { error: null };
}
