import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const DB_PATH = process.env.AI_LAB_DB ?? path.join(process.cwd(), "data", "ai-lab.db");

// DB と同じ場所に置くファイル（ツールの自動テストの画面の写真など）
export function dataDir(...parts: string[]): string {
  const dir = path.join(path.dirname(DB_PATH), ...parts);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  task TEXT NOT NULL,
  models TEXT NOT NULL,
  reps INTEGER NOT NULL,
  variant TEXT NOT NULL,
  lang TEXT NOT NULL,
  mock INTEGER NOT NULL,
  status TEXT NOT NULL,
  total_calls INTEGER NOT NULL,
  done_calls INTEGER NOT NULL DEFAULT 0,
  estimate_usd REAL NOT NULL,
  actual_usd REAL NOT NULL DEFAULT 0,
  note TEXT,
  error TEXT
);
CREATE TABLE IF NOT EXISTS results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES runs(id),
  model_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  item_author TEXT NOT NULL,
  rep INTEGER NOT NULL,
  output TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  error TEXT,
  format_ok INTEGER NOT NULL DEFAULT 0,
  correct INTEGER NOT NULL DEFAULT 0,
  score REAL NOT NULL DEFAULT 0,
  canonical TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS results_run ON results(run_id, model_id);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- ここから製品ループ（AIが作るプロダクト案件）
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  title TEXT NOT NULL,
  target TEXT NOT NULL,
  problem TEXT NOT NULL,
  solution TEXT NOT NULL,
  hypothesis TEXT NOT NULL,
  ai_reason TEXT NOT NULL,
  ai_confidence REAL,
  stage TEXT NOT NULL,
  lp TEXT,
  model_id TEXT NOT NULL,
  theme TEXT,
  demo INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  decided_at TEXT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  proposal TEXT NOT NULL,
  reason TEXT NOT NULL,
  payload TEXT,
  comment TEXT
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  project_id INTEGER REFERENCES projects(id),
  actor TEXT NOT NULL,
  kind TEXT NOT NULL,
  message TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  day TEXT NOT NULL,
  visits INTEGER NOT NULL,
  signups INTEGER NOT NULL,
  ad_spend_jpy INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  project_id INTEGER,
  purpose TEXT NOT NULL,
  model_id TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cost_usd REAL NOT NULL,
  error TEXT
);
CREATE TABLE IF NOT EXISTS lp_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  project_id INTEGER NOT NULL REFERENCES projects(id),
  version INTEGER NOT NULL,
  lp TEXT NOT NULL,
  note TEXT,
  review TEXT
);
-- 判断の裏比較: 実際の判断と同じ入力を他のAIにも渡し、答えを記録だけする
CREATE TABLE IF NOT EXISTS shadow_judgments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id INTEGER NOT NULL,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  project_id INTEGER NOT NULL REFERENCES projects(id),
  approval_id INTEGER,
  lp_version INTEGER NOT NULL,
  model_id TEXT NOT NULL,
  is_primary INTEGER NOT NULL,
  decision TEXT,
  confidence REAL,
  reason TEXT,
  next_action TEXT,
  error TEXT
);
-- AIの意見が割れたときの議論（判断の承認待ち1件につき1回）
CREATE TABLE IF NOT EXISTS debates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  approval_id INTEGER NOT NULL,
  round_id INTEGER NOT NULL,
  status TEXT NOT NULL, -- running / agreed / done / error
  payload TEXT,
  error TEXT
);
-- 毎日のアイデア出し: 3社が出した候補と、作者を伏せた採点
CREATE TABLE IF NOT EXISTS idea_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  batch_id TEXT NOT NULL,
  label TEXT NOT NULL, -- 採点時に使った伏せ字（A, B, ...）
  author_model TEXT NOT NULL,
  title TEXT NOT NULL,
  payload TEXT NOT NULL,
  avg_score REAL,
  selected INTEGER NOT NULL DEFAULT 0,
  project_id INTEGER
);
CREATE TABLE IF NOT EXISTS idea_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  candidate_id INTEGER NOT NULL REFERENCES idea_candidates(id),
  scorer_model TEXT NOT NULL,
  score REAL NOT NULL,
  reason TEXT
);
-- LPのデザイン候補（最初の版だけ、3社に1案ずつ作らせて、作者を伏せて採点する）
CREATE TABLE IF NOT EXISTS lp_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  project_id INTEGER NOT NULL REFERENCES projects(id),
  version INTEGER NOT NULL,
  label TEXT NOT NULL, -- 採点時に使った伏せ字（A, B, ...）
  author_model TEXT NOT NULL,
  lp TEXT NOT NULL,
  avg_score REAL,
  selected INTEGER NOT NULL DEFAULT 0, -- AIの採点で選ばれた
  human_selected INTEGER NOT NULL DEFAULT 0 -- 人が公開前に切り替えた
);
CREATE TABLE IF NOT EXISTS lp_candidate_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  candidate_id INTEGER NOT NULL REFERENCES lp_candidates(id),
  scorer_model TEXT NOT NULL,
  score REAL NOT NULL,
  reason TEXT
);
-- SNSの投稿。投稿ごとに専用のリンク（?s=code）を付けて、そこから来た訪問と成果を数える
CREATE TABLE IF NOT EXISTS sns_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  project_id INTEGER NOT NULL REFERENCES projects(id),
  platform TEXT NOT NULL DEFAULT 'x',
  code TEXT NOT NULL UNIQUE,
  angle TEXT, -- AIが考えた切り口
  text TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT 'ai', -- ai = AIの下書き / human = あなたが書いた
  status TEXT NOT NULL DEFAULT 'draft', -- draft / posted
  posted_at TEXT,
  post_url TEXT,
  impressions INTEGER, -- 表示回数（Xのアナリティクスから手入力。任意）
  visits INTEGER NOT NULL DEFAULT 0,
  conversions INTEGER NOT NULL DEFAULT 0
);
-- 週ごとのレポート（AIが1週間の数字と動きをまとめ、発信用の下書きも作る）
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  model_id TEXT NOT NULL,
  content TEXT NOT NULL -- JSON（Report 型）
);
-- 集客の作戦（フォロワー0のアカウントを、どこから伸ばすかをAIが考えたもの）
CREATE TABLE IF NOT EXISTS growth_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  model_id TEXT NOT NULL,
  input TEXT, -- そのときのフォロワー数や、あなたの希望
  content TEXT NOT NULL, -- JSON（GrowthPlan 型）
  done TEXT NOT NULL DEFAULT '[]' -- 「今週やること」のうち済んだものの番号（JSON）
);
-- 自分のSNSの投稿についたコメント。AIが返信の案を書き、人が「送る」を押したものだけ返信する
CREATE TABLE IF NOT EXISTS sns_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
  post_id INTEGER NOT NULL REFERENCES sns_posts(id),
  project_id INTEGER NOT NULL REFERENCES projects(id),
  platform TEXT NOT NULL, -- threads / bluesky
  ext_id TEXT NOT NULL, -- そのサービスでのコメントのID（Bluesky は at:// のURI）
  ext_cid TEXT, -- Bluesky で返信するときに使う
  root_uri TEXT, -- Bluesky: 自分の投稿のURI
  root_cid TEXT,
  author TEXT NOT NULL,
  text TEXT NOT NULL,
  commented_at TEXT,
  draft TEXT, -- AIが書いた返信の案（空なら「返さなくてよい」）
  draft_reason TEXT, -- 返さなくてよい理由など
  status TEXT NOT NULL DEFAULT 'new', -- new / replied / ignored
  reply_url TEXT,
  replied_at TEXT,
  UNIQUE (platform, ext_id)
);
-- ページの中での動き（公開サイトの lp_events から、取り込むたびに作り直す）。版ごと・イベントごとの人数
CREATE TABLE IF NOT EXISTS lp_funnel (
  project_id INTEGER NOT NULL REFERENCES projects(id),
  version INTEGER NOT NULL,
  name TEXT NOT NULL, -- cta_click / form_start / section_view / scroll_depth / sign_up / sign_up_error / tool_use / share
  detail TEXT NOT NULL DEFAULT '',
  visitors INTEGER NOT NULL
);
-- 世の中の話題（Googleトレンドの急上昇ワード、はてなブックマークの人気エントリー）。毎日1回取って、アイデア出しに渡す
CREATE TABLE IF NOT EXISTS trend_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
  source TEXT NOT NULL, -- google / hatena
  items TEXT NOT NULL -- JSON（TrendItem[]）
);
-- 実験メモ: 実験で気づいたこと。AI（開発中の観察）とあなたの両方が書ける
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  author TEXT NOT NULL CHECK (author IN ('ai', 'human')),
  topic TEXT NOT NULL, -- idea / design / judge / cost / tool / other
  certainty TEXT NOT NULL DEFAULT 'once', -- once = 1回見ただけ / trend = 何度か見た / confirmed = 数字で確かめた
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  project_id INTEGER REFERENCES projects(id)
);
CREATE TABLE IF NOT EXISTS lessons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  project_id INTEGER REFERENCES projects(id),
  text TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);
`;

const g = globalThis as unknown as { __aiLabDb?: Database.Database; __aiLabSchema?: string };

export function db(): Database.Database {
  if (!g.__aiLabDb) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    const conn = new Database(DB_PATH);
    conn.pragma("journal_mode = WAL");
    g.__aiLabDb = conn;
  }
  // 開発中にスキーマを足しても、サーバーを再起動せずに反映されるようにする
  const version = SCHEMA + JSON.stringify(EXTRA_COLUMNS);
  if (g.__aiLabSchema !== version) {
    g.__aiLabDb.exec(SCHEMA);
    addColumns(g.__aiLabDb);
    g.__aiLabSchema = version;
  }
  return g.__aiLabDb;
}

// サーバーに移すとき用: 送られてきたDBの中身で、今のDBを丸ごと置き換える
// 先に別のファイルに書いて開けるか確かめてから入れ替えるので、壊れたファイルで上書きはしない
export function replaceDatabase(bytes: Buffer): { projects: number } {
  const tmp = `${DB_PATH}.import`;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(tmp, bytes);
  try {
    const check = new Database(tmp, { readonly: true });
    const ok = (check.pragma("integrity_check", { simple: true }) as string) === "ok";
    const hasProjects = !!check.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'projects'").get();
    check.close();
    if (!ok || !hasProjects) throw new Error("送られてきたファイルは、このダッシュボードのDBではありません");
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
  g.__aiLabDb?.close();
  g.__aiLabDb = undefined;
  g.__aiLabSchema = undefined;
  for (const suffix of ["-wal", "-shm"]) fs.rmSync(DB_PATH + suffix, { force: true });
  fs.renameSync(tmp, DB_PATH);
  return { projects: (db().prepare("SELECT COUNT(*) AS n FROM projects").get() as { n: number }).n };
}

// 後から足した列。既存のDBにも追加する
const EXTRA_COLUMNS: [table: string, column: string, def: string][] = [
  ["projects", "mode", "TEXT NOT NULL DEFAULT 'manual'"], // manual = 毎回承認 / auto = 自動で進める
  ["projects", "origin", "TEXT NOT NULL DEFAULT 'manual'"], // manual = 手動で依頼 / daily = 毎日の自動実行
  ["projects", "lp_version", "INTEGER NOT NULL DEFAULT 0"],
  ["projects", "improve_count", "INTEGER NOT NULL DEFAULT 0"],
  ["projects", "judged_visits", "INTEGER NOT NULL DEFAULT 0"], // 最後にAIが判断した時点の訪問数
  ["projects", "judged_ad_jpy", "INTEGER NOT NULL DEFAULT 0"], // 最後にAIが判断した時点の広告費
  ["metrics", "lp_version", "INTEGER NOT NULL DEFAULT 1"],
  ["approvals", "lp_version", "INTEGER NOT NULL DEFAULT 1"],
  ["shadow_judgments", "round_id", "INTEGER NOT NULL DEFAULT 0"],
  ["projects", "idea_model", "TEXT"], // アイデアを考えたAI（LPなど以降の作業は設定のAIが行う）
  ["projects", "public_slug", "TEXT"], // 公開用LPサイトでのURLの一部（実際に公開したものだけ）
  ["approvals", "initial_choice", "TEXT"], // 判断: AIの意見を見る前に人が選んだもの
  ["approvals", "final_choice", "TEXT"], // 判断: AIの意見と議論を見たあとに人が確定したもの
  ["projects", "kind", "TEXT NOT NULL DEFAULT 'lp'"],
  ["lp_versions", "author_model", "TEXT"], // その版のLPを書いたAI
  ["projects", "public_version", "INTEGER"], // 公開用サイトに今出している版
  ["lp_versions", "test", "TEXT"],
  ["notes", "is_public", "INTEGER NOT NULL DEFAULT 0"], // 実験の公開ページに載せる
  ["projects", "notify_status", "TEXT"], // 撤退したときの登録者への連絡: pending = まだ / done = 連絡してメールアドレスを削除した // 動くツールの、ブラウザでの自動テストの結果（JSON） // 出し方: lp = 事前登録LP / tool = 動くツール
  ["metrics", "shares", "INTEGER NOT NULL DEFAULT 0"], // 動くツールがシェアされた数
  ["projects", "sns_paused", "INTEGER NOT NULL DEFAULT 0"],
  ["projects", "first_channel", "TEXT"], // 企画のときに決めた、最初の利用者がいる場所
  ["projects", "first_test", "TEXT"], // 企画のときに決めた、最初の1週間の検証
  ["projects", "published_at", "TEXT"], // 最初に公開した日時
  ["projects", "judged_at", "TEXT"], // 最後にAIが判断した日時
  ["projects", "rethink_count", "INTEGER NOT NULL DEFAULT 0"], // 集客の見直しをした回数
  ["projects", "growth_focus", "TEXT"], // いまの集客の切り口・場所・対象（見直しで変わる）
  ["projects", "growth_phase", "INTEGER NOT NULL DEFAULT 0"], // 1 = 「続ける」になって、育てる段階に入った
  ["projects", "growth_count", "INTEGER NOT NULL DEFAULT 0"], // 育てる段階で試した実験の数 // この案件だけSNSへの自動投稿を止める
  ["projects", "auto_published", "INTEGER NOT NULL DEFAULT 0"], // 人の承認なしで公開した（全自動）
  ["projects", "human_review", "TEXT"], // 全自動で公開したものを、人があとから見た評価: ok = 問題なし / bad = 出すべきでなかった
  ["projects", "human_review_note", "TEXT"],
  ["projects", "human_review_at", "TEXT"],
  ["projects", "mode_confidence", "REAL"], // モードを決めたときに使った自信（毎日の実行では他社の採点の平均、手動では自己申告）
];

function addColumns(conn: Database.Database) {
  for (const [table, column, def] of EXTRA_COLUMNS) {
    const cols = conn.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!cols.some((c) => c.name === column)) conn.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
  }
}

export type RunRow = {
  id: number;
  created_at: string;
  finished_at: string | null;
  task: string;
  models: string;
  reps: number;
  variant: string;
  lang: string;
  mock: number;
  status: "queued" | "running" | "done" | "stopped" | "error";
  total_calls: number;
  done_calls: number;
  estimate_usd: number;
  actual_usd: number;
  note: string | null;
  error: string | null;
};

export type ResultRow = {
  id: number;
  run_id: number;
  model_id: string;
  item_id: string;
  item_author: string;
  rep: number;
  output: string | null;
  input_tokens: number;
  output_tokens: number;
  latency_ms: number;
  cost_usd: number;
  error: string | null;
  format_ok: number;
  correct: number;
  score: number;
  canonical: string | null;
};

export type Settings = {
  monthlyBudgetJpy: number;
  usdJpy: number;
  killSwitch: boolean;
  loopModel: string; // 製品ループで使うAI
  adBudgetPerProjectJpy: number; // 1案件あたりの広告費上限
  judgeMinVisits: number; // この訪問数を超えたらAIに判断させる
  targetSignupRate: number; // 登録率の目標（これを下回ると撤退候補）
  approvalMode: ApprovalMode; // 新しい案件をどちらのモードで進めるか
  dailyEnabled: boolean; // 毎日の自動アイデア出し
  dailyHour: number; // 何時以降に実行するか
  dailyIdeaCount: number; // 1社あたりに出させるアイデア数（3社で出す）
  dailyKeep: number; // そのうち残す数
  maxPending: number; // 承認待ちがこの件数以上なら、自動アイデア出しを休む
  maxLive: number; // 集客中がこの件数以上なら、自動アイデア出しを休む
  maxAutoImprove: number; // 自動モードで、人の承認なしにLPを改善してよい回数
  staleDays: number; // この日数放置された承認待ちは見送りにする
  lastDailyRun: string; // 最後に毎日の実行をした日（YYYY-MM-DD）
  shadowJudge: boolean; // 判断のたびに他社の上位AIにも同じ判断をさせて記録する
  debateEnabled: boolean; // AIの判断が割れたら、AI同士に1回反論させて要約する
  improveExtraBudgetJpy: number; // 広告費の上限を超えたあと、改善して再挑戦するために使ってよい追加の広告費（0 = 上限を超えたら改善しない）
  lpBaseUrl: string; // 公開用LPサイトのURL（例: https://example.com）
  autoConfidence: number; // 「AIの自信で決める」とき、これ以上の自信なら自動モードにする（0〜1）
  targetUseRate: number; // 動くツールの利用率の目標（訪問のうち実際に使った割合）
  trendNotes: string; // アイデア出しに渡す「いま話題のネタ」（運営者が自由に書く）
  weeklyReport: boolean; // 毎週月曜に、1週間のレポートをAIに作らせる
  lastWeeklyReport: string; // 最後に週のレポートを作った日（YYYY-MM-DD）
  showcaseEnabled: boolean; // 実験の様子を見せる公開ページ（/showcase）を出す
  showcaseShowLinks: boolean; // 公開ページに、LP・ツールへのリンクを載せる
  operatorName: string; // 登録者に連絡するときの差出人（屋号）
  contactEmail: string; // 登録者に連絡するときの問い合わせ先
  snsAccount: string; // LP・ツールを紹介する X のアカウント（@なし）
  illustrations: boolean; // LPの見出しの横に、AIが描いたイラストを置く
  freePage: boolean; // 事前登録LPのページ全体を、部品ではなくAIに自由にデザインさせる
  fullAuto: boolean; // 自動モードの案件は、公開・撤退も人の承認なしで行う（人はあとから見て印を付ける）
  autoPublishPerWeek: number; // 人の承認なしで新しく公開してよい件数（直近7日）
  autoPost: boolean; // 集客中の案件を、AIが X に自動で投稿する（X のAPIキーが必要）
  autoPostPerDay: number; // 自動投稿の上限（直近24時間）
  judgeAfterDays: number; // 訪問が少なくても、公開（または前の判断）からこの日数がたったらAIに判断させる
};

export type ApprovalMode = "manual" | "auto" | "alternate" | "confidence";

const DEFAULTS: Settings = {
  monthlyBudgetJpy: 10000,
  usdJpy: 150,
  killSwitch: false,
  loopModel: "claude-opus-5-5",
  adBudgetPerProjectJpy: 10000,
  judgeMinVisits: 100,
  targetSignupRate: 0.03,
  approvalMode: "alternate",
  autoConfidence: 0.7,
  targetUseRate: 0.3,
  trendNotes: "",
  weeklyReport: true,
  lastWeeklyReport: "",
  showcaseEnabled: false,
  showcaseShowLinks: false,
  operatorName: "",
  contactEmail: "",
  snsAccount: "",
  illustrations: true,
  freePage: true,
  fullAuto: false,
  autoPublishPerWeek: 3,
  autoPost: false,
  autoPostPerDay: 2,
  judgeAfterDays: 7,
  dailyEnabled: false,
  dailyHour: 9,
  dailyIdeaCount: 2,
  dailyKeep: 2,
  maxPending: 3,
  maxLive: 2,
  maxAutoImprove: 2,
  staleDays: 7,
  lastDailyRun: "",
  shadowJudge: true,
  debateEnabled: true,
  improveExtraBudgetJpy: 0,
  lpBaseUrl: "",
};

const STRING_KEYS = new Set(["loopModel", "approvalMode", "lastDailyRun", "lpBaseUrl", "trendNotes", "lastWeeklyReport", "operatorName", "contactEmail", "snsAccount"]);
const BOOL_KEYS = new Set(["killSwitch", "dailyEnabled", "shadowJudge", "debateEnabled", "weeklyReport", "showcaseEnabled", "showcaseShowLinks", "illustrations", "freePage", "fullAuto", "autoPost"]);

export function getSettings(): Settings {
  const rows = db().prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[];
  const s = { ...DEFAULTS } as Record<string, unknown>;
  for (const r of rows) {
    if (!(r.key in DEFAULTS)) continue;
    s[r.key] = BOOL_KEYS.has(r.key) ? r.value === "1" : STRING_KEYS.has(r.key) ? r.value : Number(r.value);
  }
  return s as Settings;
}

export function saveSettings(patch: Partial<Settings>) {
  const stmt = db().prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  );
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    stmt.run(k, typeof v === "boolean" ? (v ? "1" : "0") : String(v));
  }
}

// 今月のAI費用（比較テストの実API分 + 製品ループでのAI呼び出し）
export function monthSpendUsd(): number {
  return monthSpendBreakdownUsd().total;
}

export function monthSpendBreakdownUsd() {
  const evalRow = db()
    .prepare(
      "SELECT COALESCE(SUM(actual_usd), 0) AS s FROM runs WHERE mock = 0 AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')",
    )
    .get() as { s: number };
  const loopRow = db()
    .prepare("SELECT COALESCE(SUM(cost_usd), 0) AS s FROM ai_calls WHERE strftime('%Y-%m', at) = strftime('%Y-%m', 'now')")
    .get() as { s: number };
  return { eval: evalRow.s, loop: loopRow.s, total: evalRow.s + loopRow.s };
}

// 今月の広告費（円）
export function monthAdSpendJpy(): number {
  const row = db()
    .prepare("SELECT COALESCE(SUM(ad_spend_jpy), 0) AS s FROM metrics WHERE strftime('%Y-%m', day) = strftime('%Y-%m', 'now')")
    .get() as { s: number };
  return row.s;
}

export type ProjectRow = {
  id: number;
  created_at: string;
  updated_at: string;
  title: string;
  target: string;
  problem: string;
  solution: string;
  hypothesis: string;
  ai_reason: string;
  ai_confidence: number | null;
  stage: Stage;
  lp: string | null;
  model_id: string;
  theme: string | null;
  demo: number;
  mode: "manual" | "auto";
  origin: "manual" | "daily";
  lp_version: number;
  improve_count: number;
  judged_visits: number;
  judged_ad_jpy: number;
  idea_model: string | null;
  public_slug: string | null;
  mode_confidence: number | null;
  kind: ProductKind;
  public_version: number | null;
  notify_status: "pending" | "done" | null;
  auto_published: number;
  sns_paused: number;
  first_channel: string | null;
  first_test: string | null;
  published_at: string | null;
  judged_at: string | null;
  rethink_count: number;
  growth_focus: string | null;
  growth_phase: number;
  growth_count: number;
  human_review: "ok" | "bad" | null;
  human_review_note: string | null;
  human_review_at: string | null;
};

// 出し方（形）。アイデアを出すときにAIが選ぶ
export type ProductKind = "lp" | "tool";

export type LpVersionRow = { id: number; created_at: string; project_id: number; version: number; lp: string; note: string | null; review: string | null; author_model: string | null; test: string | null };
export type LpCandidateRow = {
  id: number; at: string; project_id: number; version: number; label: string; author_model: string; lp: string;
  avg_score: number | null; selected: number; human_selected: number;
};

export type ApprovalRow = {
  id: number;
  created_at: string;
  decided_at: string | null;
  project_id: number;
  kind: ApprovalKind;
  status: "pending" | "approved" | "rejected" | "revised" | "expired" | "overridden";
  proposal: string;
  reason: string;
  payload: string | null;
  comment: string | null;
  initial_choice: string | null;
  final_choice: string | null;
  lp_version: number;
};

export type EventRow = { id: number; at: string; project_id: number | null; actor: "ai" | "human" | "system"; kind: string; message: string };
// signups は「成果」の数: 事前登録LPなら登録、動くツールなら使った人の数
export type MetricRow = { id: number; project_id: number; day: string; visits: number; signups: number; ad_spend_jpy: number; source: string; lp_version: number; shares: number };
export type LessonRow = { id: number; at: string; project_id: number | null; text: string; active: number };

// 案件の段階: アイデア → LP作成 → 集客中 → 判断待ち → 継続 / 撤退（却下はアイデア段階で止めたもの）
export type Stage = "idea" | "lp" | "live" | "deciding" | "continued" | "killed" | "rejected";
export type ApprovalKind = "idea" | "publish" | "decision";
