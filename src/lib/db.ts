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
-- 毎日の計画: 毎朝AIが全案件を振り返り、今のネックと今日やること（投稿・ページの改善など）を決める
CREATE TABLE IF NOT EXISTS daily_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day TEXT NOT NULL UNIQUE, -- 日本時間の YYYY-MM-DD
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  model_id TEXT NOT NULL,
  content TEXT NOT NULL, -- JSON: PlanContent（ネック・根拠・目標・昨日の振り返りなど）
  pause_new INTEGER NOT NULL DEFAULT 0, -- 今日は新しい案件づくりを休む
  idea_note TEXT -- 次のアイデア出しに伝える、今の課題
);
-- 計画の中の1つ1つの予定。5分ごとの見回りで、時刻が来たものから実行する
CREATE TABLE IF NOT EXISTS plan_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL REFERENCES daily_plans(id),
  at_time TEXT NOT NULL, -- 日本時間の HH:MM
  kind TEXT NOT NULL, -- promo = 案件の宣伝の投稿 / plain = 宣伝ではない普通の投稿 / improve = ページを直す
  platform TEXT, -- x / threads / bluesky（投稿のとき）
  project_id INTEGER, -- 宣伝・改善する案件
  angle TEXT, -- 投稿の切り口・直す内容
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending / done / failed / skipped / cancelled
  result TEXT, -- 投稿した文・結果・失敗の理由
  result_url TEXT,
  done_at TEXT
);
-- 提案箱: 毎日の計画でAIが「自分ではできないが、やると効く」と考えたことと、週の定例会議で出た改善案
CREATE TABLE IF NOT EXISTS plan_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER REFERENCES daily_plans(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  title TEXT NOT NULL,
  how TEXT, -- 具体的にどうしてほしいか
  why TEXT, -- なぜ効くと考えたか
  status TEXT NOT NULL DEFAULT 'open', -- open / done / declined
  note TEXT, -- あなたのひとこと（やった結果・やらない理由）
  decided_at TEXT
);
-- 外の声: 実際の人の反応（AIの解釈ではないもの）。公開ページの「ひとこと聞かせてください」から届いたものと、運営者が聞いて記録したもの
CREATE TABLE IF NOT EXISTS external_voices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  project_id INTEGER,
  source TEXT NOT NULL, -- site = 公開ページの質問 / acquaintance = 知人 / community = コミュニティ / sns = SNS / other
  choice TEXT, -- 公開ページの質問で選ばれた項目
  text TEXT NOT NULL DEFAULT '',
  remote_id INTEGER UNIQUE, -- 公開ページの質問のとき、Supabase の feedback の id
  version INTEGER
);
-- 調べもの: 朝会のAIが「分からないこと」を1つ決め、Webの公開情報で調べた結果（出典つき）。分からなければ保留のまま残す
CREATE TABLE IF NOT EXISTS research (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  plan_id INTEGER,
  project_id INTEGER,
  question TEXT NOT NULL, -- 分からないこと
  why TEXT, -- 分かると、どの判断が変わるか
  how TEXT, -- どう調べるか
  asked_by TEXT, -- 問いを決めたAI
  status TEXT NOT NULL DEFAULT 'pending', -- pending / running / answered / unknown / failed
  summary TEXT, -- 分かったこと
  findings TEXT, -- JSON: [{point, url, title}]
  unknown TEXT, -- 調べても分からなかったこと
  model_id TEXT,
  searches INTEGER,
  done_at TEXT
);
-- 日報: 毎晩、その日の朝会の担当AIが1日の結果を書く。運営者が自分のnoteに貼る下書きと画像も一緒に作る
CREATE TABLE IF NOT EXISTS daily_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day TEXT NOT NULL UNIQUE, -- 日本時間の YYYY-MM-DD
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  model_id TEXT NOT NULL,
  content TEXT NOT NULL, -- JSON: DiaryContent
  note_title TEXT NOT NULL,
  note_body TEXT NOT NULL, -- note に貼る Markdown（運営者の感想を書く欄を残してある）
  images TEXT NOT NULL DEFAULT '[]' -- JSON: [{file, label}]
);
-- 外の声で変わった判断: AIが外の声を根拠に、何を変えたか
CREATE TABLE IF NOT EXISTS voice_effects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  scene TEXT NOT NULL, -- 朝会 / 判断 / 定例会議
  model_id TEXT,
  project_id INTEGER,
  voice_ids TEXT NOT NULL, -- JSON: external_voices の id
  change TEXT NOT NULL
);
-- 社員の声: AIの社員のつぶやき・感想・心配・ダメ出し（決めることはない。気になったものは提案箱へ昇格できる）
CREATE TABLE IF NOT EXISTS voices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  model_id TEXT,
  scene TEXT NOT NULL, -- 声が出た場面（判断・教訓・LPのチェック・朝会・定例会議 など）
  project_id INTEGER,
  text TEXT NOT NULL,
  request_id INTEGER -- 提案箱に昇格したとき
);
CREATE TABLE IF NOT EXISTS interventions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  happened TEXT NOT NULL,
  noticed TEXT NOT NULL,
  decision TEXT NOT NULL,
  result TEXT,
  found_by TEXT,
  commit_sha TEXT,
  seed_key TEXT,
  hidden INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS record_videos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  caption TEXT NOT NULL,
  file TEXT NOT NULL,
  model_id TEXT NOT NULL,
  script TEXT NOT NULL
);

-- 週の定例会議: 3社がそれぞれ1週間を振り返って改善案を出し、作者を伏せて採点し合う。上位の案を提案箱に入れる
CREATE TABLE IF NOT EXISTS meetings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  chair_model TEXT NOT NULL, -- 議事録と発信用の下書きをまとめたAI（週ごとに交代）
  content TEXT NOT NULL, -- JSON: WeeklyContent
  report_id INTEGER -- 一緒に作った発信用の下書き（reports）
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
-- デザインの参考のライブラリ: あなたが選んだLPのURLから、画面を撮ってAIがタグを付ける（ページを作るときの参考にだけ使う。公開はしない）
CREATE TABLE IF NOT EXISTS design_refs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  url TEXT NOT NULL UNIQUE,
  title TEXT,
  status TEXT NOT NULL DEFAULT 'queued', -- queued / ok / error
  error TEXT,
  shot_pc TEXT, -- dataDir("refs") の中のファイル名
  shot_sp TEXT,
  tags TEXT, -- JSON: { mood, industry, layout, palette, typography }
  note TEXT, -- どこが良いか（AIのメモ）
  used INTEGER NOT NULL DEFAULT 0 -- ページ作りで参考にした回数
);
-- 話題の個人開発の投稿: あなたが貼ったURLと、週1回のXの検索で拾ったもの。AIが「なぜ伸びたか」をまとめ、投稿・LP・アイデア出しの参考にする（画像は保存しない）
CREATE TABLE IF NOT EXISTS viral_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  tweet_id TEXT NOT NULL UNIQUE,
  url TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual', -- manual / search
  status TEXT NOT NULL DEFAULT 'queued', -- queued / ok / error
  error TEXT,
  author TEXT,
  text TEXT,
  posted_at TEXT,
  likes INTEGER, reposts INTEGER, bookmarks INTEGER, views INTEGER, images INTEGER,
  analysis TEXT -- JSON: { genre, format, hook, visual, why, takeaway, angle }
);
-- 「こういうの欲しい」の声: 週1回のXの検索で拾い、AIがプロダクトの需要だけを残す。アイデア出しに渡す（投稿者には返信・メンションしない）
CREATE TABLE IF NOT EXISTS user_wants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  tweet_id TEXT NOT NULL UNIQUE,
  url TEXT NOT NULL,
  text TEXT NOT NULL,
  posted_at TEXT,
  likes INTEGER, reposts INTEGER, bookmarks INTEGER, replies INTEGER,
  status TEXT NOT NULL DEFAULT 'ok', -- ok（需要）/ rejected（買い物の話など、プロダクトの需要ではない）
  who TEXT, -- 誰が
  problem TEXT, -- 何に困っている・何が欲しい
  note TEXT -- AIのメモ（外した理由など）
);
-- 自由なデザインのページの候補（Claude と別の会社のAIの2案を作り、画面を見たAIの採点で1つを公開する。以前は参考なし・参考ありの2案）
CREATE TABLE IF NOT EXISTS page_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  project_id INTEGER NOT NULL REFERENCES projects(id),
  version INTEGER NOT NULL,
  with_refs INTEGER NOT NULL DEFAULT 0,
  ref_ids TEXT, -- JSON: 見せた参考の番号
  score REAL,
  reason TEXT,
  selected INTEGER NOT NULL DEFAULT 0,
  check_json TEXT -- PageCheck（撮った画面など）
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
  ["lp_versions", "tool_model", "TEXT"],
  ["lp_versions", "tool_rewrites", "INTEGER"], // チェックやテストで問題が出て、書き直した回数 // その版のツールのコードを書いたAI（ツール作成のAIの比較用）
  ["idea_candidates", "practice", "INTEGER NOT NULL DEFAULT 0"], // ライブ画面の「アイデア出しだけ見る」で出したもの（案件にしない・成績に数えない）
  ["projects", "end_reason", "TEXT"], // 撤退した理由の分類: unreached / unused / unspread / stopped
  ["projects", "first_channel", "TEXT"], // 企画のときに決めた、最初の利用者がいる場所
  ["projects", "first_test", "TEXT"], // 企画のときに決めた、最初の1週間の検証
  ["projects", "want_id", "INTEGER"], // 元になった「欲しい」の声（user_wants）
  ["page_candidates", "html", "TEXT"], // その案のページ（あとから人が入れ替えられるように残す）
  ["page_candidates", "judges", "TEXT"],
  // 投稿の反応（投稿の翌日と3日後に取り込む）と、切り口の型（効いた手の集計用）
  ["sns_posts", "likes", "INTEGER"],
  ["sns_posts", "replies", "INTEGER"],
  ["sns_posts", "reposts", "INTEGER"],
  ["sns_posts", "reactions_at", "TEXT"],
  ["sns_posts", "angle_type", "TEXT"],
  ["plan_tasks", "likes", "INTEGER"],
  ["plan_tasks", "replies", "INTEGER"],
  ["plan_tasks", "reposts", "INTEGER"],
  ["plan_tasks", "reactions_at", "TEXT"],
  ["plan_tasks", "angle_type", "TEXT"],
  // AIだけで出した投稿を、人があとから見て付ける印（ok / bad）とひとこと。bad の書き方は次の計画で避けさせる
  // 提案箱: plan_requests に、毎朝の計画のお願いと、週の定例会議の提案をまとめる
  ["plan_requests", "source", "TEXT NOT NULL DEFAULT 'plan'"], // plan = 毎朝の計画 / meeting = 定例会議 / scene = ふだんの作業の途中 / error = エラーが続いた / revival = 敗者復活 / human = あなた / voice = 社員の声から昇格
  ["plan_requests", "proposer", "TEXT"], // 提案したAI
  ["plan_requests", "target", "TEXT NOT NULL DEFAULT 'human'"], // human = 運営者がやること / system = 仕組み（コード）の改善
  ["plan_requests", "score", "REAL"], // 定例会議で、ほかのAIが付けた点の平均（10点満点）
  ["plan_requests", "meeting_id", "INTEGER"],
  ["plan_requests", "scene", "TEXT"], // どの場面で出た提案か（例: 判断 #42）
  ["plan_requests", "project_id", "INTEGER"],
  ["plan_requests", "ref_id", "INTEGER"], // 敗者復活: 元のアイデアの候補（idea_candidates）
  ["plan_requests", "ai_reply", "TEXT"], // あなたが入れた提案への、AIの返事
  ["meetings", "kind", "TEXT NOT NULL DEFAULT 'weekly'"], // weekly = 週の定例会議 / adhoc = あなたが議題を出した臨時会議
  ["meetings", "topic", "TEXT"], // 臨時会議の議題
  ["voice_effects", "research_ids", "TEXT"], // JSON: 判断を変えた根拠になった調べもの（research の id）
  ["sns_posts", "human_review", "TEXT"],
  ["sns_posts", "human_note", "TEXT"],
  ["plan_tasks", "human_review", "TEXT"],
  ["plan_tasks", "human_note", "TEXT"], // JSON: 採点したAIごとの点数 [{modelId, a, b, reason}]（a が先に作った案）
  ["page_candidates", "model", "TEXT"], // その案のページを書いたAI（空なら、参考のあり・なしで比べていたころの案で、Claude が書いた）
  ["lessons", "fact", "TEXT"], // 観測した事実（数字など）
  ["lessons", "interpretation", "TEXT"], // 仮の解釈
  ["lessons", "unknown", "TEXT"], // まだ判断できないこと
  ["lessons", "certainty", "TEXT"], // 確かさ: low（データ不足・保留）/ mid / high
  ["projects", "growth_focus_at", "TEXT"], // 集客の方針を最後に見直した日時（見直す前後の数字を分けるため）
  ["projects", "published_at", "TEXT"], // 最初に公開した日時
  ["projects", "judged_at", "TEXT"], // 最後にAIが判断した日時
  ["interventions", "result", "TEXT"], // 修正後の結果
  ["interventions", "found_by", "TEXT"], // 問題を見つけたのは誰か（カンマ区切り）
  ["interventions", "seed_key", "TEXT"], // 最初に入れた事例の目印（コードの内容で更新するため）
  ["projects", "index_visits", "INTEGER NOT NULL DEFAULT 0"], // 公開サイトの一覧から来た訪問者の数
  ["projects", "index_uses", "INTEGER NOT NULL DEFAULT 0"], // そのうち登録・利用した人の数
  ["projects", "hold_reason", "TEXT"], // 保留にした理由（人が書く）
  ["projects", "hold_until", "TEXT"], // 集客に戻す日（日本時間 YYYY-MM-DD）
  ["projects", "resumed_at", "TEXT"], // 保留から戻した日時（戻ってすぐ「日数がたった」と判断しないように）
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
  // 提案箱は、計画のない提案（定例会議）も入るので plan_id を空にできるようにした。空の表のときだけ作り直す
  const pr = conn.prepare("PRAGMA table_info(plan_requests)").all() as { name: string; notnull: number }[];
  if (pr.find((c) => c.name === "plan_id")?.notnull && !(conn.prepare("SELECT COUNT(*) AS n FROM plan_requests").get() as { n: number }).n) {
    conn.exec(`DROP TABLE plan_requests;
CREATE TABLE plan_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, plan_id INTEGER REFERENCES daily_plans(id), created_at TEXT NOT NULL DEFAULT (datetime('now')),
  title TEXT NOT NULL, how TEXT, why TEXT, status TEXT NOT NULL DEFAULT 'open', note TEXT, decided_at TEXT);`);
  }
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
  showcaseVoices: boolean; // 公開ページに、社員の声を載せる
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
  lastDigest: string; // 最後に1日のまとめを送った日（日本時間の YYYY-MM-DD）
  notifyLive: boolean; // AIが何かを始めた・終えたときに、その場で通知する（1日のまとめとは別）
  notifyOff: string; // その場の通知で送らない種類（カンマ区切り。liveNotify.ts の NOTIFY_KINDS）
  viralSearch: boolean; // 週1回、Xで話題の個人開発の投稿を検索して取り込む（X のAPIキーが必要。読んだ投稿1件ごとに費用がかかる）
  viralSearchCount: number; // 1回の検索で読む投稿の数（100件ずつ）
  lastViralSearch: string; // 最後に検索した日時（ISO）
  wantsSearchCount: number; // 同じ検索のときに、「欲しい」の声を読む数（100件ずつ。0 なら探さない）
  dailyReport: boolean; // 毎晩、AIが1日の日報と note の下書きを書く
  dailyPlan: boolean; // 毎朝AIが全案件を振り返って、今日の計画（投稿の回数・時刻・切り口、ページの改善など）を決めて動く
  promoOff: string; // 宣伝の投稿（リンク付き）をしない場所（カンマ区切り。例: x）
  plainOff: string; // 普通の投稿（リンクなし）をしない場所（カンマ区切り）
  postSafetyPerDay: number; // 毎日の計画で投稿するときの安全装置（場所ごと・直近24時間）。AIの目標ではなく、異常を止めるための値
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
  showcaseVoices: false,
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
  lastDigest: "",
  notifyLive: true,
  notifyOff: "",
  viralSearch: true,
  viralSearchCount: 300,
  lastViralSearch: "",
  wantsSearchCount: 200,
  dailyReport: true,
  dailyPlan: true,
  postSafetyPerDay: 10,
  promoOff: "",
  plainOff: "",
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

const STRING_KEYS = new Set(["loopModel", "approvalMode", "lastDailyRun", "lpBaseUrl", "trendNotes", "lastWeeklyReport", "operatorName", "contactEmail", "snsAccount", "lastDigest", "lastViralSearch", "promoOff", "plainOff", "notifyOff"]);
const BOOL_KEYS = new Set(["killSwitch", "dailyEnabled", "shadowJudge", "debateEnabled", "weeklyReport", "showcaseEnabled", "showcaseShowLinks", "illustrations", "freePage", "fullAuto", "autoPost", "viralSearch", "dailyPlan", "dailyReport", "showcaseVoices", "notifyLive"]);

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
  end_reason: string | null;
  first_channel: string | null;
  first_test: string | null;
  want_id: number | null;
  published_at: string | null;
  judged_at: string | null;
  index_visits: number;
  index_uses: number;
  hold_reason: string | null;
  hold_until: string | null;
  resumed_at: string | null;
  rethink_count: number;
  growth_focus: string | null;
  growth_focus_at: string | null;
  growth_phase: number;
  growth_count: number;
  human_review: "ok" | "bad" | null;
  human_review_note: string | null;
  human_review_at: string | null;
};

// 出し方（形）。アイデアを出すときにAIが選ぶ
export type ProductKind = "lp" | "tool";

export type LpVersionRow = { id: number; created_at: string; project_id: number; version: number; lp: string; note: string | null; review: string | null; author_model: string | null; test: string | null; tool_model: string | null; tool_rewrites: number | null };
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
export type LessonRow = { id: number; at: string; project_id: number | null; text: string; active: number; fact: string | null; interpretation: string | null; unknown: string | null; certainty: "low" | "mid" | "high" | null };

// 案件の段階: アイデア → LP作成 → 集客中 → 判断待ち → 継続 / 撤退（却下はアイデア段階で止めたもの）
export type Stage = "idea" | "lp" | "live" | "hold" | "deciding" | "continued" | "killed" | "rejected"; // hold = 公開は続けるが、宣伝・判断・改善を止めている
export type ApprovalKind = "idea" | "publish" | "decision";
