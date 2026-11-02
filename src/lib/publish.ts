import { createClient } from "@supabase/supabase-js";
import { db, getSettings, type ProjectRow } from "./db";
import { attributePosts } from "./sns";

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
  db().prepare("UPDATE projects SET public_slug = ?, public_version = ? WHERE id = ?").run(slugOf(p.id), p.lp_version, p.id);
  return true;
}

// 撤退などで受付を終える（ページは「受付終了」の表示になる）
export async function closeLp(p: ProjectRow) {
  if (!publishingConfigured() || !p.public_slug) return false;
  const { error } = await sb().from("lps").update({ status: "closed", updated_at: new Date().toISOString() }).eq("slug", p.public_slug);
  if (error) throw new Error(`LPの受付終了に失敗しました: ${error.message}`);
  return true;
}

// Supabase は1回に最大1000行しか返さないので、全部そろうまで続けて取る
type Row = { version: number; day: string; visitor_id: string; kind?: string; source?: string | null };
const COLUMNS = { lp_views: "version, day, visitor_id, source", signups: "version, day, visitor_id", tool_events: "version, day, visitor_id, kind" } as const;

async function fetchAll(table: keyof typeof COLUMNS, slug: string, columns: string = COLUMNS[table]): Promise<Row[]> {
  const rows: Row[] = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await sb().from(table).select(columns).eq("slug", slug).order("id").range(from, from + page - 1);
    if (error) {
      // 投稿ごとの計測（source 列）を Supabase に追加する前でも、訪問は数えられるようにする
      if (table === "lp_views" && columns.includes("source") && /source/.test(error.message)) return fetchAll(table, slug, "version, day, visitor_id");
      throw new Error(`集計の取得に失敗しました（${table}）: ${error.message}`);
    }
    rows.push(...(data as unknown as Row[]));
    if (data.length < page) return rows;
  }
}

// 公開中のLPの訪問と成果（事前登録LPは登録、動くツールは使った人）を、日付と版ごとに数えてダッシュボードに取り込む
export async function syncRealMetrics(): Promise<{ projects: number; visits: number; signups: number }> {
  if (!publishingConfigured()) return { projects: 0, visits: 0, signups: 0 };
  const projects = db().prepare("SELECT * FROM projects WHERE public_slug IS NOT NULL AND demo = 0").all() as ProjectRow[];
  let visits = 0;
  let signups = 0;
  for (const p of projects) {
    const slug = p.public_slug!;
    const views = await fetchAll("lp_views", slug);
    const isTool = p.kind === "tool";
    const events = isTool ? await fetchAll("tool_events", slug) : [];
    const conv = isTool ? events.filter((e) => e.kind === "use") : await fetchAll("signups", slug);
    const shares = events.filter((e) => e.kind === "share");

    const agg = new Map<string, { day: string; version: number; visits: number; signups: number; shares: number }>();
    const bump = (r: { version: number; day: string }, field: "visits" | "signups" | "shares") => {
      const k = `${r.day}|${r.version}`;
      const a = agg.get(k) ?? { day: r.day, version: r.version, visits: 0, signups: 0, shares: 0 };
      a[field] += 1;
      agg.set(k, a);
    };
    views.forEach((r) => bump(r, "visits"));
    conv.forEach((r) => bump(r, "signups"));
    shares.forEach((r) => bump(r, "shares"));

    // 本物の数字は毎回まとめて入れ直す（広告費などの手入力の行はそのまま残す）
    const conn = db();
    conn.transaction(() => {
      conn.prepare("DELETE FROM metrics WHERE project_id = ? AND source = 'real'").run(p.id);
      const ins = conn.prepare("INSERT INTO metrics (project_id, day, visits, signups, shares, ad_spend_jpy, source, lp_version) VALUES (?, ?, ?, ?, ?, 0, 'real', ?)");
      for (const a of agg.values()) ins.run(p.id, a.day, a.visits, a.signups, a.shares, a.version);
    })();
    attributePosts(p.id, views, conv);
    visits += views.length;
    signups += conv.length;
  }
  return { projects: projects.length, visits, signups };
}
