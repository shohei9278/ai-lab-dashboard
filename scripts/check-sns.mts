// SNSのキーが正しく入っているかを確かめる（各サービスにログインして、自分のアカウント名を読むだけ。投稿はしない。値は表示しない）
//   npx tsx --env-file=.env.local scripts/check-sns.mts
import crypto from "node:crypto";

const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const has = (k: string) => !!process.env[k];

async function x() {
  if (!["X_API_KEY", "X_API_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_SECRET"].every(has)) return "キー未設定";
  const url = "https://api.x.com/2/users/me";
  const o: Record<string, string> = { oauth_consumer_key: process.env.X_API_KEY!, oauth_nonce: crypto.randomBytes(16).toString("hex"), oauth_signature_method: "HMAC-SHA1", oauth_timestamp: String(Math.floor(Date.now() / 1000)), oauth_token: process.env.X_ACCESS_TOKEN!, oauth_version: "1.0" };
  const ps = Object.keys(o).sort().map((k) => `${enc(k)}=${enc(o[k])}`).join("&");
  o.oauth_signature = crypto.createHmac("sha1", `${enc(process.env.X_API_SECRET!)}&${enc(process.env.X_ACCESS_SECRET!)}`).update(["GET", enc(url), enc(ps)].join("&")).digest("base64");
  const r = await fetch(url, { headers: { Authorization: "OAuth " + Object.keys(o).sort().map((k) => `${enc(k)}="${enc(o[k])}"`).join(", ") } });
  const b = await r.json().catch(() => ({}));
  return r.ok ? `@${b.data?.username} として認証できました` : `失敗（${r.status}）`;
}

async function threads() {
  if (!has("THREADS_ACCESS_TOKEN")) return "キー未設定";
  const r = await fetch(`https://graph.threads.net/v1.0/me?fields=username&access_token=${encodeURIComponent(process.env.THREADS_ACCESS_TOKEN!)}`);
  const b = await r.json().catch(() => ({}));
  return r.ok ? `@${b.username} として認証できました` : `失敗（${r.status}）: ${JSON.stringify(b.error?.message ?? "").slice(0, 120)}`;
}

async function bluesky() {
  if (!has("BLUESKY_HANDLE") || !has("BLUESKY_APP_PASSWORD")) return "キー未設定";
  const r = await fetch("https://bsky.social/xrpc/com.atproto.server.createSession", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: process.env.BLUESKY_HANDLE, password: process.env.BLUESKY_APP_PASSWORD }),
  });
  const b = await r.json().catch(() => ({}));
  return r.ok ? `@${b.handle} としてログインできました` : `失敗（${r.status}）: ${b.message ?? ""}`;
}

console.log("X:", await x());
console.log("Threads:", await threads());
console.log("Bluesky:", await bluesky());
