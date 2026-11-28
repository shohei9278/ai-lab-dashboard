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
import { toolAiSpecOf, type ToolAiSpec } from "@/lp/toolAi";

export type LpRow = { slug: string; project_id: number; version: number; title: string; content: Lp; status: "published" | "closed" };

export async function getLp(slug: string): Promise<LpRow | null> {
  if (!/^[a-z0-9-]{1,40}$/.test(slug)) return null;
  const { data, error } = await supabase().from("lps").select("*").eq("slug", slug).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as LpRow;
  return { ...row, content: normalizeLp(row.content) };
}

// category: 一覧のカテゴリ（ダッシュボードが公開の中身に入れたもの。categories.ts。ないものもある）
export type ListedPage = { slug: string; title: string; version: number; sub: string | null; category?: string | null };

// 公開中のページの一覧（トップページ用）。動くツールと事前登録のページに分ける。ツール本体のHTMLは重いので読まない
export async function listPages(): Promise<{ tools: ListedPage[]; lps: ListedPage[] }> {
  const published = () => supabase().from("lps").select("slug, title, version, project_id, sub:content->>subheadline, category:content->>category").eq("status", "published");
  const [tools, lps] = await Promise.all([
    published().not("content->tool", "is", null).order("project_id", { ascending: false }),
    published().is("content->tool", null).order("project_id", { ascending: false }),
  ]);
  if (tools.error) throw tools.error;
  if (lps.error) throw lps.error;
  return { tools: (tools.data ?? []) as unknown as ListedPage[], lps: (lps.data ?? []) as unknown as ListedPage[] };
}

// その場で AI を呼ぶツールの、人が承認した AI への指示（公開中の今の版のものだけ。なければ null）
// 指示の本文は、ここ（公開サイトのサーバー）でだけ読む。getLp（画面に渡す中身）は長さの上限だけを残すので使わない（toolAi.ts）
export async function getToolAiSpec(slug: string, version: number): Promise<ToolAiSpec | null> {
  if (!/^[a-z0-9-]{1,40}$/.test(slug) || !Number.isInteger(version)) return null;
  const { data, error } = await supabase().from("lps").select("version, status, ai:content->tool->ai").eq("slug", slug).maybeSingle();
  if (error) throw error;
  const row = data as { version: number; status: string; ai: unknown } | null;
  if (!row || row.status !== "published" || row.version !== version) return null;
  const spec = toolAiSpecOf(row.ai);
  return typeof spec === "string" ? null : spec;
}
