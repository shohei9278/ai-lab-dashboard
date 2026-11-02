// 動作確認で入れたテスト用のデータを消す。本物の訪問者のデータは消さない
//   npx tsx scripts/delete-test-data.mts <slug> <テストのメール@example.com>  … その登録と、その人の訪問を消す
//   npx tsx scripts/delete-test-data.mts <slug> <訪問者ID>                    … その訪問者の訪問だけを消す
// 訪問者IDは、確認に使ったブラウザの localStorage の lp_visitor_id
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const [slug, who] = process.argv.slice(2);
const isEmail = !!who?.endsWith("@example.com");
const isVisitor = !!who && /^[0-9a-f-]{36}$/.test(who);
if (!slug || (!isEmail && !isVisitor)) throw new Error("slug と、@example.com のテスト用メールか訪問者IDを指定してください");

const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

let visitorId = isVisitor ? who : null;
if (isEmail) {
  const found = await sb.from("signups").select("visitor_id").eq("slug", slug).eq("email", who).maybeSingle();
  visitorId = (found.data as { visitor_id?: string } | null)?.visitor_id ?? null;
  const s = await sb.from("signups").delete({ count: "exact" }).eq("slug", slug).eq("email", who);
  console.log("signups deleted", s.count, s.error?.message ?? "");
}
if (visitorId) {
  const v = await sb.from("lp_views").delete({ count: "exact" }).eq("slug", slug).eq("visitor_id", visitorId);
  console.log("lp_views deleted", v.count, v.error?.message ?? "");
}
