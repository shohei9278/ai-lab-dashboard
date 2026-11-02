// 動作確認で入れたテスト用の登録と訪問を消す（npx tsx scripts/delete-test-data.mts <slug> <テストのメール>）
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
const [slug, email] = process.argv.slice(2);
if (!slug || !email?.endsWith("@example.com")) throw new Error("slug と @example.com のテスト用メールを指定してください");
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const s = await sb.from("signups").delete({ count: "exact" }).eq("slug", slug).eq("email", email);
const v = await sb.from("lp_views").delete({ count: "exact" }).eq("slug", slug);
console.log("signups deleted", s.count, s.error?.message ?? "", "/ lp_views deleted", v.count, v.error?.message ?? "");
