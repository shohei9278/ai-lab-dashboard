import { importSiteFeedback } from "./outside";
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
type Row = { version: number; day: string; visitor_id: string; kind?: string; source?: string | null; name?: string; detail?: string };
const COLUMNS = {
  lp_views: "version, day, visitor_id, source", signups: "version, day, visitor_id", tool_events: "version, day, visitor_id, kind",
  lp_events: "version, day, visitor_id, name, detail",
} as const;

async function fetchAll(table: keyof typeof COLUMNS, slug: string, columns: string = COLUMNS[table]): Promise<Row[]> {
  const rows: Row[] = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const get = () => sb().from(table).select(columns).eq("slug", slug).order("id").range(from, from + page - 1);
    let { data, error } = await get();
    // 通信の一時的な失敗（fetch failed など）は、少し待って1回だけやり直す
    if (error && /fetch failed|network|timeout|ECONN|ETIMEDOUT/i.test(error.message)) {
      await new Promise((r) => setTimeout(r, 3000));
      ({ data, error } = await get());
    }
    if (error) {
      // 投稿ごとの計測（source 列）を Supabase に追加する前でも、訪問は数えられるようにする
      if (table === "lp_views" && columns.includes("source") && /source/.test(error.message)) return fetchAll(table, slug, "version, day, visitor_id");
      throw new Error(`集計の取得に失敗しました（${table}）: ${error.message}`);
    }
    const got = (data ?? []) as unknown as Row[];
    rows.push(...got);
    if (got.length < page) return rows;
  }
}

// 公開ページの「ひとこと聞かせてください」に届いた声を取り込む（表をまだ作っていなければ何もしない）
async function syncFeedback(projectId: number, slug: string) {
  const last = (db().prepare("SELECT COALESCE(MAX(remote_id), 0) AS m FROM external_voices WHERE project_id = ? AND source = 'site'").get(projectId) as { m: number }).m;
  const { data, error } = await sb().from("feedback").select("id, version, choice, text, created_at").eq("slug", slug).gt("id", last).order("id").limit(500);
  if (error || !data?.length) return;
  importSiteFeedback(projectId, data as { id: number; version: number; choice: string; text: string | null; created_at: string }[]);
}

// 公開中のLPの訪問と成果（事前登録LPは登録、動くツールは使った人）を、日付と版ごとに数えてダッシュボードに取り込む
export async function syncRealMetrics(): Promise<{ projects: number; visits: number; signups: number }> {
  if (!publishingConfigured()) return { projects: 0, visits: 0, signups: 0 };
  // 撤退した案件は取り込まない（登録者のメールアドレスを消したあとも、それまでの数字を残すため）
  const projects = db().prepare("SELECT * FROM projects WHERE public_slug IS NOT NULL AND demo = 0 AND stage NOT IN ('killed', 'rejected')").all() as ProjectRow[];
  let visits = 0;
  let signups = 0;
  for (const p of projects) {
    const slug = p.public_slug!;
    const views = await fetchAll("lp_views", slug);
    await syncFeedback(p.id, slug);
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
    await syncFunnel(p.id, slug);
    visits += views.length;
    signups += conv.length;
  }
  return { projects: projects.length, visits, signups };
}

// ページの中での動き（ボタン・入力開始・読んだ深さなど）を、版・イベントごとの人数にまとめて入れ直す
// 公開サイトの Supabase に lp_events の表をまだ作っていないときは、何もしない
async function syncFunnel(projectId: number, slug: string) {
  let rows: Row[];
  try {
    rows = await fetchAll("lp_events", slug);
  } catch (e) {
    if (/lp_events/.test(e instanceof Error ? e.message : "")) return;
    throw e;
  }
  const people = new Map<string, Set<string>>();
  for (const r of rows) {
    const k = `${r.version}|${r.name}|${r.detail ?? ""}`;
    if (!people.has(k)) people.set(k, new Set());
    people.get(k)!.add(r.visitor_id);
  }
  const conn = db();
  conn.transaction(() => {
    conn.prepare("DELETE FROM lp_funnel WHERE project_id = ?").run(projectId);
    const ins = conn.prepare("INSERT INTO lp_funnel (project_id, version, name, detail, visitors) VALUES (?, ?, ?, ?, ?)");
    for (const [k, set] of people) {
      const [version, name, detail] = k.split("|");
      ins.run(projectId, Number(version), name, detail, set.size);
    }
  })();
}

// ---- AIが描いたイラストの置き場所（Supabase の公開用の保存領域） ----

const BUCKET = "lp-images";

// 画像を保存して、誰でも見られるURLを返す。保存領域がまだ無ければ作る
export async function uploadImage(path: string, bytes: Buffer, contentType: string): Promise<string> {
  if (!publishingConfigured()) throw new Error("Supabase の設定がないため、画像を保存できません");
  const client = sb();
  let { error } = await client.storage.from(BUCKET).upload(path, bytes, { contentType, upsert: true });
  if (error && /not found|does not exist/i.test(error.message)) {
    const made = await client.storage.createBucket(BUCKET, { public: true, fileSizeLimit: 5 * 1024 * 1024, allowedMimeTypes: ["image/webp", "image/png", "image/jpeg"] });
    if (made.error && !/already exists/i.test(made.error.message)) throw new Error(`画像の保存場所を作れませんでした: ${made.error.message}`);
    ({ error } = await client.storage.from(BUCKET).upload(path, bytes, { contentType, upsert: true }));
  }
  if (error) throw new Error(`画像を保存できませんでした: ${error.message}`);
  return client.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

// ---- 撤退したときの登録者への連絡 ----

// 連絡のための宛先（メールアドレス）。画面で見るときだけ取り出し、ダッシュボードには保存しない
export async function signupEmails(slug: string): Promise<string[]> {
  const { data, error } = await sb().from("signups").select("email").eq("slug", slug).order("id");
  if (error) throw new Error(`登録者の取得に失敗しました: ${error.message}`);
  return (data as { email: string }[]).map((r) => r.email);
}

// 連絡が済んだら、その案件の登録者のメールアドレスを消す（プライバシーポリシーの約束どおり）
export async function deleteSignups(slug: string): Promise<number> {
  const { error, count } = await sb().from("signups").delete({ count: "exact" }).eq("slug", slug);
  if (error) throw new Error(`メールアドレスの削除に失敗しました: ${error.message}`);
  return count ?? 0;
}
