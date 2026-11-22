import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { importSiteFeedback } from "./outside";
import { createClient } from "@supabase/supabase-js";
import { dataDir, db, getSettings, type ProjectRow } from "./db";
import { attributePosts } from "./sns";
import { channelStats, hostOf } from "./channels";
import { checkToolErrors } from "./funnel";
import { autoRollback } from "./rollback";
import { logEvent } from "./loop";
import { classifySiteCategory, isSiteCategory, type SiteCategory } from "./siteCategory";

// 公開用LPサイト（Vercel）とデータ（Supabase）をつなぐ部分。
// Supabase の設定がなければ何もしない（今までどおり手入力・シミュレーションで動く）

export function publishingConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export function sb() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
}

export const slugOf = (projectId: number) => `p${projectId}`;

export function publicUrl(projectId: number): string | null {
  const base = getSettings().lpBaseUrl.replace(/\/+$/, "");
  return base ? `${base}/${slugOf(projectId)}` : null;
}

// 公開サイトの一覧のカテゴリ（動くツールだけ）。運営者が選んだものがあればそれ、なければ軽いAIの判定（まだなら、ここで選ばせる）
// 運営者が選んだ直後の値を使うよう、案件はデータベースから読み直す（呼んだ側が持っている行は、古いことがある）
// AIの判定に失敗したときは、そのまま投げる（公開するときは呼ぶ側で受け流し、そろえ直しでは失敗として数える。PR #99 の ai-review の指摘）
async function categoryFor(p: ProjectRow): Promise<SiteCategory | null> {
  const now = (db().prepare("SELECT * FROM projects WHERE id = ?").get(p.id) as ProjectRow | undefined) ?? p;
  if (now.kind !== "tool") return null;
  if (isSiteCategory(now.site_category)) return now.site_category;
  return classifySiteCategory(now);
}

// 今のLPの版を公開する（すでに公開中なら新しい版に差し替える）
export async function publishLp(p: ProjectRow) {
  if (!publishingConfigured() || p.demo || !p.lp) return false;
  // 動くツールは、一覧のカードとシェア画像に本物の画面を使う。上げられなくても公開は止めない（イラストのカードのまま）
  const shot = await uploadToolShot(p, p.lp_version).catch(() => null);
  const { error } = await sb().from("lps").upsert({
    slug: slugOf(p.id),
    project_id: p.id,
    version: p.lp_version,
    title: p.title,
    // 公開サイトの一覧のカテゴリも、中身に入れて渡す（表の列は増やさない）
    // AIの判定に失敗しても公開は止めない（カテゴリなしで公開し、次に起動したときのそろえ直しで、また選ばせる）
    // shot は、ここで上げた写真だけにする（LPを書いたAIの出力に紛れたものは使わない）
    content: { ...JSON.parse(p.lp), category: await categoryFor(p).catch(() => null), shot: shot ?? undefined },
    status: "published",
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(`LPの公開に失敗しました: ${error.message}`);
  db().prepare("UPDATE projects SET public_slug = ?, public_version = ? WHERE id = ?").run(slugOf(p.id), p.lp_version, p.id);
  return true;
}

// 公開中のページの、一覧のカテゴリだけを今のものにそろえる（中身の版は変えない）。変えたら true
// 運営者がカテゴリを選び直したときと、カテゴリを渡すようにする前に公開したページをそろえるときに使う
// 中身は丸ごと読んで書き戻すので、読んでから書くまでに新しい版が公開されると、古い中身で上書きしてしまう。
// そこで、読んだときの updated_at のままのときだけ書き換え（書き換えたら updated_at も進める）、変わっていたら読み直してもう1回だけやる（PR #99 の ai-review の指摘）
export async function syncSiteCategory(p: ProjectRow): Promise<boolean> {
  if (!publishingConfigured() || p.demo || !p.public_slug) return false;
  for (let attempt = 0; attempt < 2; attempt++) {
    // やり直すたびに、案件を読み直してカテゴリを決め直す（その間に運営者が選び直していたら、新しいほうを書く。PR #99 の ai-review の指摘）
    const category = await categoryFor(p);
    const { data, error } = await sb().from("lps").select("content, updated_at").eq("slug", p.public_slug).maybeSingle();
    if (error) throw new Error(`公開中のページを読めませんでした: ${error.message}`);
    if (!data) return false;
    const content = data.content as Record<string, unknown>;
    if ((content.category ?? null) === category) return false;
    const base = sb().from("lps").update({ content: { ...content, category }, updated_at: new Date().toISOString() }).eq("slug", p.public_slug);
    const up = await (data.updated_at === null ? base.is("updated_at", null) : base.eq("updated_at", data.updated_at)).select("slug");
    if (up.error) throw new Error(`一覧のカテゴリを変えられませんでした: ${up.error.message}`);
    if (up.data?.length) return true;
  }
  throw new Error("公開中のページが続けて書き換わったため、一覧のカテゴリを変えられませんでした（次に起動したときに、またそろえます）");
}

// 1件ずつ処理し、失敗しても残りを続ける（成功した件数と、失敗の件数・最初の理由を返す）
export async function eachSettled<T>(items: T[], fn: (item: T) => Promise<boolean>): Promise<{ changed: number; failed: number; firstError: string | null }> {
  let changed = 0, failed = 0;
  let firstError: string | null = null;
  for (const item of items) {
    try {
      if (await fn(item)) changed++;
    } catch (e) {
      failed++;
      firstError ??= e instanceof Error ? e.message : String(e);
    }
  }
  return { changed, failed, firstError };
}

// ---- 動くツールの本物の画面（一覧のカードとシェア画像に使う） ----

export type ToolShot = { url: string; width: number; height: number };

// 版の自動テストで撮った、何も押す前の1画面（firstShot）のファイル名
// 押したあとのページ全体の写真（screenshot）は、途中の画面が出ることがあるので使わない（運営者が決めた。最初の1画面を撮る前の版は、イラストのカードのまま）
// 紹介ページの確かめ（kind = "page"）で上書きされた版は、ツールの写真がないので使わない
export function toolShotFile(projectId: number, version: number): string | null {
  const row = db().prepare("SELECT test FROM lp_versions WHERE project_id = ? AND version = ? ORDER BY id DESC LIMIT 1").get(projectId, version) as { test: string | null } | undefined;
  if (!row?.test) return null;
  try {
    const t = JSON.parse(row.test) as { kind?: string; firstShot?: string };
    if (t.kind === "page") return null;
    const file = t.firstShot;
    return file && /^[a-z0-9_-]+\.png$/i.test(file) ? file : null;
  } catch {
    return null;
  }
}

// PNG の大きさ（先頭の IHDR から読む）。PNG でなければ null
export function pngSize(b: Buffer): { width: number; height: number } | null {
  if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47 || b.toString("ascii", 12, 16) !== "IHDR") return null;
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

// その版のツールの写真を公開用の保存領域に上げて、場所と大きさを返す。ツールでない・写真がないときは null
// 同じ版でテストをやり直すと写真が変わるので、中身の短い要約を名前に入れて、古い写真が残って見えないようにする
export async function uploadToolShot(p: Pick<ProjectRow, "id" | "kind">, version: number): Promise<ToolShot | null> {
  if (p.kind !== "tool") return null;
  const file = toolShotFile(p.id, version);
  if (!file) return null;
  const full = path.join(dataDir("screenshots"), file);
  if (!fs.existsSync(full)) return null;
  const bytes = fs.readFileSync(full);
  const size = pngSize(bytes);
  if (!size) return null;
  const hash = crypto.createHash("sha1").update(bytes).digest("hex").slice(0, 8);
  const url = await uploadImage(`p${p.id}/v${version}-shot-${hash}.png`, bytes, "image/png");
  return { url, ...size };
}

// 公開したことのあるツールのページすべてのカテゴリをそろえる（サーバーを起動したあとに1回。件数は数十件まで）
// まだAIの判定がないツールは、ここで選ばせる（1件 約0.1円）
// 1件のAIの判定や書き換えに失敗しても、残りは続ける（PR #99 の ai-review の指摘）
export async function syncSiteCategories(): Promise<{ changed: number; failed: number; firstError: string | null }> {
  if (!publishingConfigured()) return { changed: 0, failed: 0, firstError: null };
  const rows = db().prepare("SELECT * FROM projects WHERE public_slug IS NOT NULL AND kind = 'tool' AND demo = 0").all() as ProjectRow[];
  return eachSettled(rows, syncSiteCategory);
}

// 撤退などで受付を終える（ページは「受付終了」の表示になる）
export async function closeLp(p: ProjectRow) {
  if (!publishingConfigured() || !p.public_slug) return false;
  const { error } = await sb().from("lps").update({ status: "closed", updated_at: new Date().toISOString() }).eq("slug", p.public_slug);
  if (error) throw new Error(`LPの受付終了に失敗しました: ${error.message}`);
  return true;
}

// Supabase は1回に最大1000行しか返さないので、全部そろうまで続けて取る
type Row = { version: number; day: string; visitor_id: string; kind?: string; source?: string | null; referrer?: string | null; name?: string; detail?: string };
const COLUMNS = {
  lp_views: "version, day, visitor_id, source, referrer", signups: "version, day, visitor_id", tool_events: "version, day, visitor_id, kind",
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
// 公開サイトの一覧（?s=index）から来た人の数と、そのうち登録・利用した人の数
export function indexCounts(views: { visitor_id: string; source?: string | null }[], conv: { visitor_id?: string | null }[]) {
  const visitors = new Set(views.filter((v) => v.source === "index").map((v) => v.visitor_id));
  const converted = new Set(conv.map((c) => c.visitor_id));
  return { visits: visitors.size, uses: [...visitors].filter((v) => converted.has(v)).length };
}

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
    const fromIndex = indexCounts(views, conv);
    conn.prepare("UPDATE projects SET index_visits = ?, index_uses = ? WHERE id = ?").run(fromIndex.visits, fromIndex.uses, p.id);
    const funnelEvents = await syncFunnel(p.id, slug, views);
    checkToolErrors(p);
    // 新しく出した版でエラーが増えていたら、前の版に自動で戻す（rollback.ts）
    await autoRollback(db().prepare("SELECT * FROM projects WHERE id = ?").get(p.id) as ProjectRow, publishLp)
      .catch((e) => logEvent(p.id, "system", "rollback-error", `自動の巻き戻しの確かめに失敗: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`));
    syncChannels(p, views, funnelEvents, conv);
    visits += views.length;
    signups += conv.length;
  }
  return { projects: projects.length, visits, signups };
}

// ページの中での動き（ボタン・入力開始・読んだ深さ・遊びの深さなど）を、版・イベントごとの人数にまとめて入れ直す
// 別の日にまた来た人（revisit）は、訪問の記録から数えて一緒に入れる
// 公開サイトの Supabase に lp_events の表をまだ作っていないときは、ページの中の動きは数えない
async function syncFunnel(projectId: number, slug: string, views: Row[]): Promise<Row[]> {
  let rows: Row[];
  try {
    rows = await fetchAll("lp_events", slug);
  } catch (e) {
    if (!/lp_events/.test(e instanceof Error ? e.message : "")) throw e;
    rows = [];
  }
  const people = funnelPeople(rows, views);
  const conn = db();
  conn.transaction(() => {
    conn.prepare("DELETE FROM lp_funnel WHERE project_id = ?").run(projectId);
    const ins = conn.prepare("INSERT INTO lp_funnel (project_id, version, name, detail, visitors) VALUES (?, ?, ?, ?, ?)");
    for (const [k, set] of people) {
      const [version, name, detail] = k.split("|");
      ins.run(projectId, Number(version), name, detail, set.size);
    }
  })();
  return rows;
}

// 版・イベント・細かい内容ごとの人（訪問者）。別の日にまた来た人は "revisit"（その版に2日以上来た人）
export function funnelPeople(events: { version: number; visitor_id: string; name?: string; detail?: string | null }[], views: { version: number; visitor_id: string; day: string }[]): Map<string, Set<string>> {
  const people = new Map<string, Set<string>>();
  const add = (k: string, v: string) => {
    if (!people.has(k)) people.set(k, new Set());
    people.get(k)!.add(v);
  };
  for (const r of events) add(`${r.version}|${r.name}|${r.detail ?? ""}`, r.visitor_id);
  const days = new Map<string, Set<string>>();
  for (const v of views) {
    const k = `${v.version}|${v.visitor_id}`;
    if (!days.has(k)) days.set(k, new Set());
    days.get(k)!.add(v.day);
  }
  for (const [k, d] of days) {
    if (d.size < 2) continue;
    const [version, visitor] = [k.slice(0, k.indexOf("|")), k.slice(k.indexOf("|") + 1)];
    add(`${version}|revisit|`, visitor);
  }
  return people;
}

// どこから来たかを、版ごと・流入元ごとに数えて保存する（来た元のページは、サイト名だけを残す）
function syncChannels(p: ProjectRow, views: Row[], events: Row[], conv: Row[]) {
  const postPlatform = new Map((db().prepare("SELECT code, platform FROM sns_posts WHERE project_id = ? AND code IS NOT NULL").all(p.id) as { code: string; platform: string }[]).map((r) => [r.code, r.platform]));
  const stats = channelStats(views, events, conv, postPlatform, p.kind === "tool", hostOf(getSettings().lpBaseUrl));
  const conn = db();
  conn.transaction(() => {
    conn.prepare("DELETE FROM lp_channels WHERE project_id = ?").run(p.id);
    const ins = conn.prepare("INSERT INTO lp_channels (project_id, version, data) VALUES (?, ?, ?)");
    for (const [version, rows] of stats) ins.run(p.id, version, JSON.stringify(rows));
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
