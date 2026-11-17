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
export async function searchRecent(query: string, nextToken?: string, maxResults = 100, startTime?: string): Promise<{ posts: XSearchPost[]; next?: string }> {
  if (!xConfigured()) throw new Error("X のAPIキーが設定されていません");
  const url = "https://api.x.com/2/tweets/search/recent";
  const params: Record<string, string> = { query, max_results: String(maxResults), sort_order: "relevancy", "tweet.fields": "public_metrics,created_at,attachments" };
  if (nextToken) params.next_token = nextToken;
  if (startTime) params.start_time = startTime;
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

// 検索で読める期間（X の検索は直近7日まで。境目で失敗しないよう少し内側にする）
const SEARCH_WINDOW_MS = 7 * 86_400_000 - 3_600_000;
// 読み始める日時: 前回の検索のあとから（同じ投稿を読み直して費用をかけないため）。前回がない・7日より前なら、読める一番古いところから
export function searchSince(last: string | undefined, now = Date.now()): string {
  const oldest = now - SEARCH_WINDOW_MS;
  const t = last ? Date.parse(last) : NaN;
  return new Date(Number.isFinite(t) && t > oldest && t < now ? t : oldest).toISOString().replace(/\.\d{3}Z$/, "Z");
}
// 1回の検索で読む件数（X の API は1回10〜100件）
export const clampPerQuery = (n: number) => Math.max(10, Math.min(100, Math.round(n)));

// 複数の検索を、それぞれ1回（perQuery 件まで）ずつ、since のあとの投稿から話題の順に読む
// 読んだ分だけ費用がかかるので、途中で失敗しても数えられるよう onRead で件数を知らせる
// 途中で失敗したら残りの検索はやめ（回数の上限などで続けて失敗するため）、それまでに読めた投稿と、失敗の理由を返す
export async function searchEach(queries: string[], perQuery: number, since: string, onRead: (n: number) => void): Promise<{ posts: XSearchPost[]; error?: string }> {
  const seen = new Map<string, XSearchPost>();
  for (const [i, q] of queries.entries()) {
    try {
      const r = await searchRecent(q, undefined, clampPerQuery(perQuery), since);
      onRead(r.posts.length);
      for (const p of r.posts) seen.set(p.id, p);
    } catch (e) {
      return { posts: [...seen.values()], error: `${queries.length}種類のうち${i + 1}種類目で失敗: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}` };
    }
  }
  return { posts: [...seen.values()] };
}
