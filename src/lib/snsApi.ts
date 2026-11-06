import crypto from "node:crypto";
import { db } from "./db";
import { X_PLAIN_POST_COST_USD, X_POST_COST_USD, postToX, xConfigured } from "./xPost";

// AIが自動で投稿できる場所（X・Threads・Bluesky）。キーは .env.local（サーバーでは環境変数）に入れる。手順は docs/SETUP-SNS.md
// どこも、運営のアカウントとして自分の投稿をするだけ。返信・フォロー・いいねなど、他人への働きかけはしない

export type AutoPlatform = "x" | "threads" | "bluesky";

type Def = {
  label: string;
  costUsd: number; // 1件あたり（リンク付き）
  configured: () => boolean;
  fits: (text: string, link: string) => boolean; // 本文＋リンクが文字数の上限に収まるか
  bodyHint: string; // 下書きを書くAIに伝える長さの目安
  post: (text: string, link: string) => Promise<{ url: string }>;
  // リンクのない普通の投稿（宣伝ではない投稿）
  plainCostUsd: number;
  plainFits: (text: string) => boolean;
  plainHint: string;
  postPlain: (text: string) => Promise<{ url: string }>;
};

// X の文字数の数え方: 日本語などは1文字を2と数え、URLは長さに関係なく23と数える。上限は280
export function xWeightedLength(text: string, withUrl = true): number {
  let n = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    const light = c <= 0x10ff || (c >= 0x2000 && c <= 0x200d) || (c >= 0x2010 && c <= 0x201f) || (c >= 0x2032 && c <= 0x2037);
    n += light ? 1 : 2;
  }
  return n + (withUrl ? 1 + 23 : 0);
}

const graphemes = (s: string) => [...new Intl.Segmenter("ja", { granularity: "grapheme" }).segment(s)].length;

// ---- Threads（Meta の公式API。無料） ----
// THREADS_ACCESS_TOKEN … 長期のアクセストークン（60日で切れるので、こちらで定期的に延長して保存する）

const THREADS_TOKEN_KEY = "threadsTokenRefreshed"; // 延長したトークンと、延長した日時（settings の表に保存）

// 延長したトークンは、元になった .env のトークンが変わっていなければ使う（.env に新しいトークンを入れたら、そちらを使う）
const envTokenId = () => crypto.createHash("sha256").update(process.env.THREADS_ACCESS_TOKEN ?? "").digest("hex").slice(0, 16);

function savedThreads(): { token: string; at: number } | null {
  const row = db().prepare("SELECT value FROM settings WHERE key = ?").get(THREADS_TOKEN_KEY) as { value: string } | undefined;
  if (!row) return null;
  const v = JSON.parse(row.value) as { token: string; at: number; from?: string };
  return v.from === envTokenId() ? v : null;
}

export function threadsToken(): string {
  return savedThreads()?.token ?? process.env.THREADS_ACCESS_TOKEN ?? "";
}

// 前に延長してから20日以上たっていたら、トークンを延長する（期限が切れる前に）
async function refreshThreadsToken() {
  const at = savedThreads()?.at ?? 0;
  if (Date.now() - at < 20 * 86_400_000) return;
  const res = await fetch(`https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token&access_token=${encodeURIComponent(threadsToken())}`);
  const data = (await res.json().catch(() => ({}))) as { access_token?: string };
  if (!res.ok || !data.access_token) return; // 延長できなくても、今のトークンが有効なら投稿はできる
  db().prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(THREADS_TOKEN_KEY, JSON.stringify({ token: data.access_token, at: Date.now(), from: envTokenId() }));
}

export async function threadsCall(path: string, params: Record<string, string>): Promise<Record<string, string>> {
  const body = new URLSearchParams({ ...params, access_token: threadsToken() });
  const res = await fetch(`https://graph.threads.net/v1.0/${path}`, { method: "POST", body });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || !data.id) throw new Error(`Threads への投稿に失敗（${res.status}）: ${JSON.stringify(data.error ?? data).slice(0, 200)}`);
  return data as Record<string, string>;
}

// Threads の投稿は「下書き（コンテナ）を作る → 公開する」の2段階。下書きの準備ができる前に公開すると
// 「The requested resource does not exist」になるので、準備ができたのを確かめてから公開する（返信も同じ）
export async function threadsPost(params: Record<string, string>): Promise<{ url: string }> {
  await refreshThreadsToken();
  const made = await threadsCall("me/threads", { media_type: "TEXT", ...params });
  const token = encodeURIComponent(threadsToken());
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, i === 0 ? 3000 : 5000));
    const st = (await fetch(`https://graph.threads.net/v1.0/${made.id}?fields=status,error_message&access_token=${token}`).then((r) => r.json()).catch(() => ({}))) as { status?: string; error_message?: string };
    if (st.status === "FINISHED") break;
    if (st.status === "ERROR" || st.status === "EXPIRED") throw new Error(`Threads の下書きの準備に失敗: ${st.error_message ?? st.status}`);
  }
  const pub = await threadsCall("me/threads_publish", { creation_id: made.id });
  const info = (await fetch(`https://graph.threads.net/v1.0/${pub.id}?fields=permalink&access_token=${token}`).then((r) => r.json()).catch(() => ({}))) as { permalink?: string };
  return { url: info.permalink ?? "https://www.threads.net/" };
}

async function postToThreads(text: string, link: string): Promise<{ url: string }> {
  return threadsPost({ text: `${text}\n${link}` });
}

// ---- Bluesky（AT Protocol。無料） ----
// BLUESKY_HANDLE … 例: hitoride.bsky.social / BLUESKY_APP_PASSWORD … 設定 → アプリパスワード で発行したもの

export async function blueskySession(): Promise<{ accessJwt: string; did: string; handle: string }> {
  const session = await fetch("https://bsky.social/xrpc/com.atproto.server.createSession", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: process.env.BLUESKY_HANDLE, password: process.env.BLUESKY_APP_PASSWORD }),
  });
  const s = (await session.json().catch(() => ({}))) as { accessJwt?: string; did?: string; handle?: string; message?: string };
  if (!session.ok || !s.accessJwt || !s.did) throw new Error(`Bluesky にログインできません（${session.status}）: ${s.message ?? ""}`.slice(0, 200));
  return { accessJwt: s.accessJwt, did: s.did, handle: s.handle ?? "" };
}

async function blueskyRecord(record: Record<string, unknown>): Promise<{ url: string }> {
  const s = await blueskySession();
  const res = await fetch("https://bsky.social/xrpc/com.atproto.repo.createRecord", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.accessJwt}` },
    body: JSON.stringify({ repo: s.did, collection: "app.bsky.feed.post", record }),
  });
  const data = (await res.json().catch(() => ({}))) as { uri?: string; message?: string };
  if (!res.ok || !data.uri) throw new Error(`Bluesky への投稿に失敗（${res.status}）: ${data.message ?? ""}`.slice(0, 200));
  return { url: `https://bsky.app/profile/${s.did}/post/${data.uri.split("/").pop()}` };
}

async function postToBluesky(text: string, link: string): Promise<{ url: string }> {
  const full = `${text}\n${link}`;
  // リンクを押せるようにする（位置はバイト数で指定する）
  const start = Buffer.byteLength(`${text}\n`);
  const record = {
    $type: "app.bsky.feed.post",
    text: full,
    createdAt: new Date().toISOString(),
    langs: ["ja"],
    facets: [{ index: { byteStart: start, byteEnd: start + Buffer.byteLength(link) }, features: [{ $type: "app.bsky.richtext.facet#link", uri: link }] }],
  };
  return blueskyRecord(record);
}

export const AUTO_PLATFORMS: Record<AutoPlatform, Def> = {
  x: {
    label: "X", costUsd: X_POST_COST_USD, configured: xConfigured,
    fits: (text) => xWeightedLength(text) <= 280,
    bodyHint: "日本語で110文字以内",
    post: (text, link) => postToX(`${text}\n${link}`),
    plainCostUsd: X_PLAIN_POST_COST_USD, plainFits: (text) => xWeightedLength(text, false) <= 280, plainHint: "日本語で130文字以内",
    postPlain: postToX,
  },
  threads: {
    label: "Threads", costUsd: 0, configured: () => !!process.env.THREADS_ACCESS_TOKEN,
    fits: (text, link) => [...`${text}\n${link}`].length <= 500,
    bodyHint: "日本語で250文字以内（会話のような、問いかけや体験談の書き方が向く）",
    post: postToThreads,
    plainCostUsd: 0, plainFits: (text) => [...text].length <= 500, plainHint: "日本語で250文字以内（会話のような書き方が向く）",
    postPlain: (text) => threadsPost({ text }),
  },
  bluesky: {
    label: "Bluesky", costUsd: 0, configured: () => !!(process.env.BLUESKY_HANDLE && process.env.BLUESKY_APP_PASSWORD),
    fits: (text, link) => graphemes(`${text}\n${link}`) <= 300,
    bodyHint: "日本語で140文字以内",
    post: postToBluesky,
    plainCostUsd: 0, plainFits: (text) => graphemes(text) <= 300, plainHint: "日本語で140文字以内",
    postPlain: (text) => blueskyRecord({ $type: "app.bsky.feed.post", text, createdAt: new Date().toISOString(), langs: ["ja"] }),
  },
};

export const autoPlatforms = () => (Object.keys(AUTO_PLATFORMS) as AutoPlatform[]).filter((k) => AUTO_PLATFORMS[k].configured());
