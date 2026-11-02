// Supabase の3つの表に読み書きできるか（schema.sql を実行済みか）を確かめる。値は表示しない
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
for (const t of ["lps", "lp_views", "signups"]) {
  const { count, error } = await sb.from(t).select("*", { count: "exact", head: true });
  console.log(t, error ? `ERROR ${error.message}` : `ok rows=${count}`);
}
