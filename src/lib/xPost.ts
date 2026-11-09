import crypto from "node:crypto";

// X（旧Twitter）に、運営のアカウントとして投稿する（API の従量課金。2026年時点で、リンク付きの投稿は1件 $0.20）
// キーは .env.local（サーバーでは環境変数）に入れる。X の Developer Console で、アプリに Read and write の権限を付けてから発行する
//   X_API_KEY / X_API_SECRET … アプリの Consumer Key と Secret
//   X_ACCESS_TOKEN / X_ACCESS_SECRET … 運営のアカウントの Access Token と Secret
export const X_POST_COST_USD = 0.2;
export const X_PLAIN_POST_COST_USD = 0.015; // リンクのない投稿

const env = () => ({
  key: process.env.X_API_KEY ?? "",
  secret: process.env.X_API_SECRET ?? "",
  token: process.env.X_ACCESS_TOKEN ?? "",
  tokenSecret: process.env.X_ACCESS_SECRET ?? "",
});

export function xConfigured(): boolean {
  const e = env();
  return !!(e.key && e.secret && e.token && e.tokenSecret);
}

const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

// OAuth 1.0a の署名（本文が JSON のときは、署名に本文を含めない。GET のときは、URLの引数を署名に含める）
function authHeader(method: string, url: string, query: Record<string, string> = {}): string {
  const e = env();
  const oauth: Record<string, string> = {
    oauth_consumer_key: e.key,
    oauth_nonce: crypto.randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: e.token,
    oauth_version: "1.0",
  };
  const all: Record<string, string> = { ...query, ...oauth };
  const params = Object.keys(all).sort().map((k) => `${enc(k)}=${enc(all[k])}`).join("&");
  const base = [method.toUpperCase(), enc(url), enc(params)].join("&");
  oauth.oauth_signature = crypto.createHmac("sha1", `${enc(e.secret)}&${enc(e.tokenSecret)}`).update(base).digest("base64");
  return "OAuth " + Object.keys(oauth).sort().map((k) => `${enc(k)}="${enc(oauth[k])}"`).join(", ");
}

export async function postToX(text: string): Promise<{ id: string; url: string }> {
  if (!xConfigured()) throw new Error("X のAPIキーが設定されていません");
  const url = "https://api.x.com/2/tweets";
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: authHeader("POST", url), "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  const data = (await res.json().catch(() => ({}))) as { data?: { id?: string }; detail?: string; title?: string };
  if (!res.ok || !data.data?.id) throw new Error(`X への投稿に失敗（${res.status}）: ${(data.detail ?? data.title ?? "").slice(0, 200)}`);
  return { id: data.data.id, url: `https://x.com/i/web/status/${data.data.id}` };
}

// 投稿を1件読むごとの費用（pay-per-use。2026年時点）
export const X_READ_COST_USD = 0.005;

// 直近7日の投稿の検索（1回100件まで。次のページの印 next_token を返す）
export type XSearchPost = {
  id: string; text: string; created_at?: string; attachments?: { media_keys?: string[] };
  public_metrics?: { like_count: number; retweet_count: number; reply_count: number; quote_count: number; bookmark_count?: number; impression_count?: number };
};
export async function searchRecent(query: string, nextToken?: string, maxResults = 100): Promise<{ posts: XSearchPost[]; next?: string }> {
  if (!xConfigured()) throw new Error("X のAPIキーが設定されていません");
  const url = "https://api.x.com/2/tweets/search/recent";
  const params: Record<string, string> = { query, max_results: String(maxResults), sort_order: "relevancy", "tweet.fields": "public_metrics,created_at,attachments" };
  if (nextToken) params.next_token = nextToken;
  const qs = Object.entries(params).map(([k, v]) => `${enc(k)}=${enc(v)}`).join("&");
  const res = await fetch(`${url}?${qs}`, { headers: { Authorization: authHeader("GET", url, params) } });
  const data = (await res.json().catch(() => ({}))) as { data?: XSearchPost[]; meta?: { next_token?: string }; detail?: string; title?: string };
  if (!res.ok) throw new Error(`X の検索に失敗（${res.status}）: ${(data.detail ?? data.title ?? "").slice(0, 200)}`);
  return { posts: data.data ?? [], next: data.meta?.next_token };
}

// 自分の投稿の反応（いいね・返信・リポスト）を読む。1件ごとに読む費用がかかる（X_READ_COST_USD）
export async function tweetMetrics(ids: string[]): Promise<Map<string, { likes: number; replies: number; reposts: number }>> {
  if (!xConfigured()) throw new Error("X のAPIキーが設定されていません");
  const url = "https://api.x.com/2/tweets";
  const params: Record<string, string> = { ids: ids.slice(0, 100).join(","), "tweet.fields": "public_metrics" };
  const qs = Object.entries(params).map(([k, v]) => `${enc(k)}=${enc(v)}`).join("&");
  const res = await fetch(`${url}?${qs}`, { headers: { Authorization: authHeader("GET", url, params) } });
  const data = (await res.json().catch(() => ({}))) as { data?: { id: string; public_metrics?: { like_count: number; reply_count: number; retweet_count: number; quote_count: number } }[]; detail?: string; title?: string };
  if (!res.ok) throw new Error(`X の投稿の反応を読めません（${res.status}）: ${(data.detail ?? data.title ?? "").slice(0, 200)}`);
  return new Map((data.data ?? []).map((t) => [t.id, {
    likes: t.public_metrics?.like_count ?? 0, replies: t.public_metrics?.reply_count ?? 0,
    reposts: (t.public_metrics?.retweet_count ?? 0) + (t.public_metrics?.quote_count ?? 0),
  }]));
}

// 複数の検索を順番に1ページずつ読む（合計 pages ページまで）。投稿が尽きた検索の分は、ほかの検索に回す
// 読んだ分だけ費用がかかるので、途中で失敗しても数えられるよう onRead で件数を知らせる
export async function searchAcross(queries: string[], pages: number, onRead: (n: number) => void): Promise<XSearchPost[]> {
  const seen = new Map<string, XSearchPost>();
  const active = queries.map((q) => ({ q, next: undefined as string | undefined }));
  let left = pages;
  while (left > 0 && active.length) {
    for (const a of [...active]) {
      if (left <= 0) break;
      const r = await searchRecent(a.q, a.next);
      left--;
      onRead(r.posts.length);
      for (const p of r.posts) seen.set(p.id, p);
      a.next = r.next;
      if (!r.next) active.splice(active.indexOf(a), 1);
    }
  }
  return [...seen.values()];
}
