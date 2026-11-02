import { createClient } from "@supabase/supabase-js";
import { db, getSettings, type ProjectRow } from "./db";

// 公開用LPサイト（Vercel）とデータ（Supabase）をつなぐ部分。
// Supabase の設定がなければ何もしない（今までどおり手入力・シミュレーションで動く）

export function publishingConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function sb() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
}

export const slugOf = (projectId: number) => `p${projectId}`;

export function publicUrl(projectId: number): string | null {
  const base = getSettings().lpBaseUrl.replace(/\/+$/, "");
  return base ? `${base}/${slugOf(projectId)}` : null;
}

// 今のLPの版を公開する（すでに公開中なら新しい版に差し替える）
export async function publishLp(p: ProjectRow) {
  if (!publishingConfigured() || p.demo || !p.lp) return false;
  const { error } = await sb().from("lps").upsert({
    slug: slugOf(p.id),
    project_id: p.id,
    version: p.lp_version,
    title: p.title,
    content: JSON.parse(p.lp),
    status: "published",
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(`LPの公開に失敗しました: ${error.message}`);
  db().prepare("UPDATE projects SET public_slug = ? WHERE id = ?").run(slugOf(p.id), p.id);
  return true;
}

// 撤退などで受付を終える（ページは「受付終了」の表示になる）
export async function closeLp(p: ProjectRow) {
  if (!publishingConfigured() || !p.public_slug) return false;
  const { error } = await sb().from("lps").update({ status: "closed", updated_at: new Date().toISOString() }).eq("slug", p.public_slug);
  if (error) throw new Error(`LPの受付終了に失敗しました: ${error.message}`);
  return true;
}

// 公開中のLPの訪問・登録を、日付と版ごとに数えてダッシュボードに取り込む
export async function syncRealMetrics(): Promise<{ projects: number; visits: number; signups: number }> {
  if (!publishingConfigured()) return { projects: 0, visits: 0, signups: 0 };
  const projects = db().prepare("SELECT * FROM projects WHERE public_slug IS NOT NULL AND demo = 0").all() as ProjectRow[];
  let visits = 0;
  let signups = 0;
  for (const p of projects) {
    const [v, s] = await Promise.all([
      sb().from("lp_views").select("version, day").eq("slug", p.public_slug!),
      sb().from("signups").select("version, day").eq("slug", p.public_slug!),
    ]);
    if (v.error || s.error) throw new Error(`集計の取得に失敗しました: ${(v.error ?? s.error)!.message}`);
    const key = (r: { version: number; day: string }) => `${r.day}|${r.version}`;
    const agg = new Map<string, { day: string; version: number; visits: number; signups: number }>();
    for (const r of v.data) {
      const k = key(r);
      agg.set(k, { day: r.day, version: r.version, visits: (agg.get(k)?.visits ?? 0) + 1, signups: agg.get(k)?.signups ?? 0 });
    }
    for (const r of s.data) {
      const k = key(r);
      agg.set(k, { day: r.day, version: r.version, visits: agg.get(k)?.visits ?? 0, signups: (agg.get(k)?.signups ?? 0) + 1 });
    }
    // 本物の数字は毎回まとめて入れ直す（広告費などの手入力の行はそのまま残す）
    const conn = db();
    conn.transaction(() => {
      conn.prepare("DELETE FROM metrics WHERE project_id = ? AND source = 'real'").run(p.id);
      const ins = conn.prepare("INSERT INTO metrics (project_id, day, visits, signups, ad_spend_jpy, source, lp_version) VALUES (?, ?, ?, ?, 0, 'real', ?)");
      for (const a of agg.values()) ins.run(p.id, a.day, a.visits, a.signups, a.version);
    })();
    visits += v.data.length;
    signups += s.data.length;
  }
  return { projects: projects.length, visits, signups };
}
