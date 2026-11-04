import crypto from "node:crypto";

// X（旧Twitter）に、運営のアカウントとして投稿する（API の従量課金。2026年時点で、リンク付きの投稿は1件 $0.20）
// キーは .env.local（サーバーでは環境変数）に入れる。X の Developer Console で、アプリに Read and write の権限を付けてから発行する
//   X_API_KEY / X_API_SECRET … アプリの Consumer Key と Secret
//   X_ACCESS_TOKEN / X_ACCESS_SECRET … 運営のアカウントの Access Token と Secret
export const X_POST_COST_USD = 0.2;

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

// OAuth 1.0a の署名（本文が JSON のときは、署名に本文を含めない）
function authHeader(method: string, url: string): string {
  const e = env();
  const oauth: Record<string, string> = {
    oauth_consumer_key: e.key,
    oauth_nonce: crypto.randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: e.token,
    oauth_version: "1.0",
  };
  const params = Object.keys(oauth).sort().map((k) => `${enc(k)}=${enc(oauth[k])}`).join("&");
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
