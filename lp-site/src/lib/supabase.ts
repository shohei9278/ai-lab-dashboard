import "server-only";
import { createClient } from "@supabase/supabase-js";

// 秘密のキーはサーバー側だけで使う（ブラウザには渡さない）
export function supabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY を設定してください");
  return createClient(url, key, { auth: { persistSession: false } });
}

import { normalizeLp, type Lp } from "@/lp/content";

export type LpRow = { slug: string; project_id: number; version: number; title: string; content: Lp; status: "published" | "closed" };

export async function getLp(slug: string): Promise<LpRow | null> {
  if (!/^[a-z0-9-]{1,40}$/.test(slug)) return null;
  const { data, error } = await supabase().from("lps").select("*").eq("slug", slug).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as LpRow;
  return { ...row, content: normalizeLp(row.content) };
}

// 公開中の動くツールの一覧（トップページ用。ツール本体のHTMLは重いので読まない）
export async function listTools(): Promise<{ slug: string; title: string; version: number; sub: string | null }[]> {
  const { data, error } = await supabase()
    .from("lps")
    .select("slug, title, version, project_id, sub:content->>subheadline")
    .eq("status", "published")
    .not("content->tool", "is", null)
    .order("project_id", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as { slug: string; title: string; version: number; sub: string | null }[];
}
