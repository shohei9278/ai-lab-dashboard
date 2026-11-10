// 運営者のログインの印。パスワードから作るので、パスワードを変えると古い印は使えなくなる
// proxy でも使えるよう、Web Crypto で作る
export const OWNER_COOKIE = "lab_owner";

export async function ownerToken(password: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(password), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode("ai-lab-owner-v1"));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
