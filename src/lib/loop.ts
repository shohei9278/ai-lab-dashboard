import { callJson, isObj, isStr } from "./ai";
import { ICONS, PREVIEW_KINDS, THEMES, TOOL_HTML_MAX, isLpCore, normalizeLp, type Lp } from "../../lp-site/src/lp/content";
import { MODELS, hasKey } from "./models";
import { testIssues, testTool, type ToolTest } from "./toolTest";
import { seasonalContext } from "./season";
import { trendsText } from "./trends";
import { closeLp, deleteSignups, publicUrl, publishLp, slugOf, syncRealMetrics } from "./publish";
import {
  db, getSettings, saveSettings,
  type ApprovalRow, type LessonRow, type LpCandidateRow, type LpVersionRow, type MetricRow, type ProductKind, type ProjectRow, type Stage,
} from "./db";

// ---- AIが作るものの形 ----

export type Idea = {
  title: string;
  target: string;
  problem: string;
  solution: string;
  hypothesis: string;
  reason: string;
  confidence: number;
  kind?: ProductKind; // 出し方（AIが選ぶ。無ければ事前登録LP）
};

// 出し方ごとの呼び方と、成果の数え方
export const KIND_LABEL: Record<ProductKind, string> = { lp: "事前登録LP", tool: "動くツール" };
export const CONV: Record<ProductKind, { noun: string; rate: string }> = {
  lp: { noun: "登録", rate: "登録率" },
  tool: { noun: "利用", rate: "利用率" },
};
export function targetRate(kind: ProductKind, s = getSettings()): number {
  return kind === "tool" ? s.targetUseRate : s.targetSignupRate;
}

// LPの型と整形は、公開用LPサイトと共通のものを使う
export type { Lp } from "../../lp-site/src/lp/content";

export type Decision = {
  decision: "continue" | "improve" | "kill" | "collect";
  reason: string;
  confidence: number;
  next_action: string;
};

export type Review = { ok: boolean; issues: string[] };

export const STAGE_LABEL: Record<Stage, string> = {
  idea: "アイデア",
  lp: "LP作成",
  live: "集客中",
  deciding: "判断待ち",
  continued: "継続",
  killed: "撤退",
  rejected: "見送り",
};

export const MODE_LABEL = { manual: "毎回承認", auto: "自動で進める" } as const;

export const DECISION_LABEL: Record<Decision["decision"], string> = {
  continue: "続ける（プロダクト化へ）",
  improve: "LPを改善して再挑戦",
  kill: "撤退する",
  collect: "今のLPのまま集客を続ける",
};

const isIdea = (v: unknown): v is Idea =>
  isObj(v) && ["title", "target", "problem", "solution", "hypothesis", "reason"].every((k) => isStr(v[k]));

const isLp = (v: unknown): v is Lp => isLpCore(v);

const isDecision = (v: unknown): v is Decision =>
  isObj(v) && ["continue", "improve", "kill", "collect"].includes(v.decision as string) && isStr(v.reason) && isStr(v.next_action);

const isReview = (v: unknown): v is Review => isObj(v) && typeof v.ok === "boolean" && Array.isArray(v.issues) && v.issues.every(isStr);

// ---- 共通 ----

export function logEvent(projectId: number | null, actor: "ai" | "human" | "system", kind: string, message: string) {
  db().prepare("INSERT INTO events (project_id, actor, kind, message) VALUES (?, ?, ?, ?)").run(projectId, actor, kind, message);
}

function setStage(projectId: number, stage: Stage) {
  db().prepare("UPDATE projects SET stage = ?, updated_at = datetime('now') WHERE id = ?").run(stage, projectId);
}

// どのLPの版について聞いたかも残す（人が却下した版で、AIが勝手に変えないようにするため）
function addApproval(projectId: number, kind: ApprovalRow["kind"], proposal: string, reason: string, payload?: unknown): number {
  return Number(
    db()
      .prepare(
        "INSERT INTO approvals (project_id, kind, proposal, reason, payload, lp_version) VALUES (?, ?, ?, ?, ?, (SELECT lp_version FROM projects WHERE id = ?))",
      )
      .run(projectId, kind, proposal, reason, payload === undefined ? null : JSON.stringify(payload), projectId).lastInsertRowid,
  );
}

export function getProject(id: number): ProjectRow | undefined {
  return db().prepare("SELECT * FROM projects WHERE id = ?").get(id) as ProjectRow | undefined;
}

export function lpVersions(projectId: number): LpVersionRow[] {
  return db().prepare("SELECT * FROM lp_versions WHERE project_id = ? ORDER BY version DESC").all(projectId) as LpVersionRow[];
}

// デモ案件の教訓は架空なので、AIへの入力には使わない（画面表示では区別して出す）
export function activeLessons({ includeDemo = false } = {}): (LessonRow & { demo: number })[] {
  return db()
    .prepare(
      `SELECT l.*, COALESCE(p.demo, 0) AS demo FROM lessons l LEFT JOIN projects p ON p.id = l.project_id
       WHERE l.active = 1 ${includeDemo ? "" : "AND COALESCE(p.demo, 0) = 0"} ORDER BY l.id DESC LIMIT 20`,
    )
    .all() as (LessonRow & { demo: number })[];
}

// version を指定すると、そのLPの版で集めた数字だけを返す
export function projectTotals(projectId: number, version?: number) {
  const all = db().prepare("SELECT * FROM metrics WHERE project_id = ? ORDER BY day, id").all(projectId) as MetricRow[];
  const rows = version === undefined ? all : all.filter((r) => r.lp_version === version);
  const visits = rows.reduce((s, r) => s + r.visits, 0);
  const signups = rows.reduce((s, r) => s + r.signups, 0);
  const adSpendJpy = rows.reduce((s, r) => s + r.ad_spend_jpy, 0);
  return { rows, visits, signups, adSpendJpy, rate: visits ? signups / visits : 0, simulated: rows.some((r) => r.source === "simulated") };
}

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// 新しい案件のモードを決める
// 「交互」は件数が少ない方へ。「AIの自信で決める」は、自信が基準以上なら自動、未満なら毎回承認
type ModeChoice = { mode: ProjectRow["mode"]; why: string };

function nextMode(confidence: { value: number | null; source: string }): ModeChoice {
  const s = getSettings();
  if (s.approvalMode === "manual" || s.approvalMode === "auto") return { mode: s.approvalMode, why: "設定" };
  if (s.approvalMode === "confidence") {
    const pct = (x: number) => `${Math.round(x * 100)}%`;
    if (confidence.value === null) return { mode: "manual", why: "自信の値がないため毎回承認" };
    const auto = confidence.value >= s.autoConfidence;
    return {
      mode: auto ? "auto" : "manual",
      why: `自信 ${pct(confidence.value)}（${confidence.source}）が基準 ${pct(s.autoConfidence)} ${auto ? "以上" : "未満"}`,
    };
  }
  const c = db().prepare("SELECT SUM(mode = 'auto') AS a, SUM(mode = 'manual') AS m FROM projects WHERE demo = 0").get() as { a: number | null; m: number | null };
  return { mode: (c.a ?? 0) < (c.m ?? 0) ? "auto" : "manual", why: "交互に割り当て" };
}

const selfConfidence = (idea: Idea) => ({
  value: typeof idea.confidence === "number" ? Math.max(0, Math.min(1, idea.confidence)) : null,
  source: "アイデアを出したAIの自己申告",
});

// ---- 1. アイデア出し ----

// modelId を指定すると、そのAIにアイデアを出させる（指定しなければ設定のAI）
async function askIdeas(theme: string, count: number, modelId?: string): Promise<Idea[]> {
  const s = getSettings();
  const lessons = activeLessons().map((l) => `- ${l.text}`).join("\n") || "（まだなし）";
  const existing = (db().prepare("SELECT title FROM projects WHERE demo = 0 ORDER BY id DESC LIMIT 30").all() as { title: string }[])
    .map((p) => `- ${p.title}`).join("\n") || "（まだなし）";
  const out = await callJson<{ ideas: Idea[] }>({
    purpose: "アイデア出し",
    modelId,
    system: `あなたは個人開発者向けにプロダクトのアイデアを考えるプロダクトマネージャーです。
アイデアごとに、世に出す形（kind）も選びます。形は1つにとらわれず、アイデアに合うものを選ぶこと。
- lp: 事前登録LP。まだ作らずに、紹介ページのメール事前登録で需要を確かめる。1人で1〜2週間で作れる、継続して使うWebサービス向け
- tool: 動くツール。診断・シミュレーター・計算機・ジェネレーターなど、1つのWebページの中だけで完結して今すぐ使えるもの。外部のAPIやサーバー、ログインは使えない。話題性・季節性があり、シェアされやすいものが向く
条件:
- 医療・法律・金融など、規制が強い領域や専門資格が必要な領域は避ける（tool でも、診断の形で助言をしない）
- 誇大な約束はしない
- 実在の人物・団体のデータを使う tool は、正確なデータをコードに書けるものだけにする
- 世の中の話題は、ヒントとして使う（そのまま題材にしなくてよい）。事件・事故・災害・訃報・個人の不祥事など、人の不幸や特定の個人に乗った企画はしない
過去の教訓がある場合は必ず踏まえ、既にある案件と重複しないこと。
形式: {"ideas":[{"kind":"lp または tool","title":"サービス名","target":"誰向けか（具体的に）","problem":"その人が困っていること・欲しいこと","solution":"どう解決するか（tool なら何ができるツールか）","hypothesis":"検証したい仮説（数字で判定できる形）","reason":"このアイデアとこの形を選んだ理由","confidence":0から1の数値（反応がある見込み）}]}`,
    // 仮説の基準と、判断で使う目標がずれないように揃える
    user: `テーマ: ${theme || "おまかせ"}\n件数: ${count}\n仮説の判定基準（形ごと。この基準を使うこと）:\n- lp: 訪問者の事前登録率 ${(s.targetSignupRate * 100).toFixed(1)}% 以上、訪問 ${s.judgeMinVisits}人で判定\n- tool: 訪問者のうち実際に使った人の割合 ${(s.targetUseRate * 100).toFixed(0)}% 以上、訪問 ${s.judgeMinVisits}人で判定（シェア数も参考にする）\n\n時期のネタ:\n${seasonalContext(new Date(), s.trendNotes)}\n\n${trendsText() || "（いまの話題はまだ取得していません）"}\n\n過去の教訓:\n${lessons}\n\n既にある案件:\n${existing}`,
    validate: (v): v is { ideas: Idea[] } => isObj(v) && Array.isArray(v.ideas) && v.ideas.length > 0 && v.ideas.every(isIdea),
  });
  return out.ideas.slice(0, count);
}

function insertProject(idea: Idea, theme: string, choice: ModeChoice & { confidence: number | null }, origin: ProjectRow["origin"], ideaModel: string): number {
  const conf = typeof idea.confidence === "number" ? Math.max(0, Math.min(1, idea.confidence)) : null;
  const { mode } = choice;
  const id = Number(
    db()
      .prepare(
        `INSERT INTO projects (title, target, problem, solution, hypothesis, ai_reason, ai_confidence, stage, model_id, theme, mode, origin, idea_model, mode_confidence, kind)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'idea', ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(idea.title, idea.target, idea.problem, idea.solution, idea.hypothesis, idea.reason, conf, getSettings().loopModel, theme || null, mode, origin, ideaModel, choice.confidence, idea.kind === "tool" ? "tool" : "lp")
      .lastInsertRowid,
  );
  logEvent(id, "ai", "idea", `アイデアを提案: ${idea.title}（${KIND_LABEL[idea.kind === "tool" ? "tool" : "lp"]}・${MODE_LABEL[mode]}モード${choice.why === "設定" ? "" : `・${choice.why}`}）`);
  return id;
}

// 毎回承認ならアイデアの承認待ちへ、自動ならLPまで作って公開の承認待ちへ
async function startProject(id: number) {
  const p = getProject(id)!;
  if (p.mode === "manual") {
    addApproval(id, "idea", `「${p.title}」で進める`, p.ai_reason);
    return;
  }
  logEvent(id, "system", "auto", "自動モードのため、アイデアの承認を省いてLPを作成");
  await prepareLp(id);
}

// 手動でアイデアを依頼したとき（選別なし）
export async function generateIdeas(theme: string, count = 3): Promise<number[]> {
  const ideas = await askIdeas(theme, count);
  const ids: number[] = [];
  for (const idea of ideas) {
    const conf = selfConfidence(idea);
    const id = insertProject(idea, theme, { ...nextMode(conf), confidence: conf.value }, "manual", getSettings().loopModel);
    ids.push(id);
    await startProject(id);
  }
  return ids;
}

// ---- 2. LP作成とAIチェック ----

async function writeLp(p: ProjectRow, instruction?: string, keepCore = false, modelId?: string, purpose = "LP作成"): Promise<Lp & { shareText?: string }> {
  const isTool = p.kind === "tool";
  const prev = p.lp ? `\n\n今のLP:\n${p.lp}` : "";
  const core = keepCore
    ? "\n- 今回は改善なので、対象読者・サービスの中身・仮説は変えない。変えるのは指示された1か所だけにし、それ以外は今のLPのまま残す"
    : "";
  const lp = await callJson<Lp>({
    purpose,
    modelId,
    projectId: p.id,
    system: `あなたはLP（サービス紹介ページ）のコピーライター兼デザイナーです。${isTool
      ? "このページには、すでに動くツール本体が埋め込まれていて、訪問者はその場で無料・登録不要で使えます。ツールを使ってもらい、気に入ったらシェアしてもらうことが目的です。"
      : "サービスはまだ開発前で、メールの事前登録で需要を確かめます。"}
守ること:
- 架空の利用者数・実績・お客様の声・受賞歴などは書かない
- 「必ず」「誰でも」などの誇大表現は使わない
- ターゲットが自分ごとだと感じる、具体的な言葉で書く
- ${isTool ? "ボタンの文言（cta）は、すぐ使えることが分かるもの（例「さっそく使ってみる」）。preview は不要。pains は使う人の動機（〜したい・〜が気になる）でもよい" : "ボタンの文言（cta）は事前登録であることが分かるようにする"}${core}
見た目も対象読者に合わせて選ぶ:
- design.theme: ${Object.entries(THEMES).map(([k, t]) => `${k}=${t.label}`).join(" / ")}
- design.layout: center=中央寄せ / split=左に文章・右に画面イメージ
- design.badge: 見出しの上に出す短いラベル（15文字以内。例「飲食店のシフト集めに」）
- preview: 完成したら使う画面のイメージ。kind は ${PREVIEW_KINDS.join(" / ")} のどれか。rows は1行あたり最大4つの短い文字列で3〜5行（list は [項目, 状態]、table は columns と各行、chat は [話し手, 発言]、form は [項目名, 入力例]）。人名は「山田さん」程度の仮名にし、実在の会社名や効果の数字は入れない
- features[].icon: ${ICONS.join(" / ")} から内容に合うもの
- steps: 使い方を3ステップ（任意）
- beforeAfter: 使う前の状態と、使ったあとに目指す状態を各2〜3個（任意。効果を断言しない）${isTool ? "\n- shareText: X でシェアするときの文（60文字以内。ハッシュタグは1つまで。誇張しない）" : ""}
形式: {"headline":"見出し","subheadline":"補足の一文","pains":["悩み","悩み","悩み"],"features":[{"title":"特徴","body":"説明","icon":"clock"}×3],"cta":"ボタンの文言","faq":[{"q":"質問","a":"回答"}×2],"design":{"theme":"trust","layout":"split","badge":"ラベル"},"preview":{"title":"画面の名前","kind":"list","columns":[],"rows":[["項目","状態"]]},"steps":[{"title":"手順","body":"説明"}×3],"beforeAfter":{"before":["今の状態"],"after":["目指す状態"]}${isTool ? ',"shareText":"シェアの文"' : ""}}`,
    user: `サービス名: ${p.title}\n対象: ${p.target}\n課題: ${p.problem}\n解決策: ${p.solution}\n仮説: ${p.hypothesis}${prev}${instruction ? `\n\n今回の修正指示: ${instruction}` : ""}`,
    validate: isLp,
  });
  // 知らない値や長すぎる文は落としてから保存する
  const shareText = (lp as { shareText?: unknown }).shareText;
  return { ...normalizeLp(lp), shareText: typeof shareText === "string" ? shareText.slice(0, 100) : undefined };
}

// 公開前に、別の観点のAIが問題がないかを確認する
async function reviewLp(p: ProjectRow, lp: Lp, before?: Lp): Promise<Review> {
  return callJson<Review>({
    purpose: "LPチェック",
    projectId: p.id,
    system: `あなたはLPの公開前チェック担当です。次の点に1つでも当てはまれば ok を false にし、issues に具体的に書きます。
- 架空の利用者数・実績・お客様の声・受賞歴・具体的な効果の数字を断言している
- 「必ず」「誰でも」「100%」などの誇大表現がある
${p.kind === "tool"
  ? "- ページの中のツールでできること以上のことを、できるかのように書いている"
  : "- 開発前なのに、すぐ使えるかのように書いている"}
- 画面イメージ（preview）や使う前後の比較（beforeAfter）に、実在の会社名・個人を特定できる名前・効果の数字の断言が入っている
- 想定の対象読者からずれている${before ? "\n- 前の版から、対象読者やサービスの中身まで変わっている（改善は文言の調整にとどめるべき）" : ""}
問題がなければ {"ok":true,"issues":[]}。
形式: {"ok":true または false,"issues":["問題点"]}`,
    user: `対象読者: ${p.target}\nサービスの中身: ${p.solution}\n\nチェックするLP:\n${JSON.stringify(lp)}${before ? `\n\n前の版:\n${JSON.stringify(before)}` : ""}`,
    validate: isReview,
  });
}

// ---- 動くツールの本体 ----

// 隔離された枠の中では使えないもの・外部への通信など、コードを読めば分かる問題を先に見つける
function staticToolIssues(html: string): string[] {
  const rules: [RegExp, string][] = [
    [/\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|navigator\.sendBeacon/, "外部と通信している（通信は遮断されるので動かない）"],
    [/<script[^>]*\bsrc\s*=|<link[^>]*\bhref\s*=|@import|url\(\s*['"]?https?:/i, "外部のファイルを読み込んでいる"],
    [/localStorage|sessionStorage|indexedDB|document\.cookie/, "保存領域や Cookie を使っている（隔離された枠では使えない）"],
    [/\b(alert|confirm|prompt)\s*\(|window\.open\s*\(/, "alert・confirm・prompt・window.open を使っている（隔離された枠では使えない）"],
    [/<form[^>]*\baction\s*=/i, "フォームをどこかに送信しようとしている"],
    [/<(html|head|body)[\s>]/i, "<html><head><body> を書いている（中身だけにする）"],
  ];
  const issues = rules.filter(([re]) => re.test(html)).map(([, msg]) => msg);
  if (html.length > TOOL_HTML_MAX) issues.push(`長すぎる（${html.length}文字。${TOOL_HTML_MAX}文字以内）`);
  if (!/<script[\s>]/i.test(html)) issues.push("スクリプトがなく、ツールとして動かない");
  return issues;
}

async function writeToolHtml(p: ProjectRow, instruction?: string, prevHtml?: string): Promise<string> {
  const out = await callJson<{ html: string }>({
    purpose: "ツール作成",
    projectId: p.id,
    system: `あなたは小さなWebツールを作るフロントエンドエンジニアです。紹介ページの中の枠に埋め込まれる、ツール本体を1つ書きます。
守ること:
- 1つのHTMLの断片だけを書く（<style> と <script> を含めてよい。<html><head><body> は書かない）
- 外部のファイル・フォント・画像・API・CDN は一切使わない（通信はすべて遮断される）。必要なデータはコードの中に書く
- localStorage・sessionStorage・Cookie・IndexedDB・alert・confirm・prompt・window.open は使えない（エラーになる）。別のページを開くリンクも動かない
- 結果を画像としてダウンロードさせることと、文をクリップボードにコピーすることはできる
- フォームは送信しない（ボタンは type="button"）。入力は端末の中だけで処理する
- 名前・メールアドレスなど個人を特定できる情報は入力させない
- スマホ幅（360px）でも崩れない。prefers-color-scheme でライト・ダークの両方で読めるようにする
- 日本語。開いた瞬間に使い方が分かり、結果はすぐ画面に表示する。結果は、シェアしたくなる見せ方を工夫する
- 架空の統計を事実のように書かない。診断・占いのような遊びのツールは、そうと分かる一言を入れる。医療・法律・お金の助言はしない
- 実在の人物・団体のデータは、正確だと確信できるものだけを使う。不確かなら使わない
- 全体で40,000文字以内。読みやすく、動作の確かなコードにする
形式: {"html":"ツール本体のHTML"}`,
    user: `ツール名: ${p.title}\n対象: ${p.target}\n使う人の動機・困りごと: ${p.problem}\n何ができるツールか: ${p.solution}${prevHtml ? `\n\n今のツール:\n${prevHtml}` : ""}${instruction ? `\n\n今回の修正指示: ${instruction}` : ""}`,
    validate: (v): v is { html: string } => isObj(v) && isStr(v.html),
  });
  return out.html.trim();
}

// ツール本体をAIが読んで、動かない箇所や問題のある内容がないかを確かめる
async function reviewTool(p: ProjectRow, html: string): Promise<Review> {
  return callJson<Review>({
    purpose: "ツールチェック",
    projectId: p.id,
    system: `あなたはWebツールの公開前チェック担当です。コードを読んで、次の点に1つでも当てはまれば ok を false にし、issues に具体的に書きます。
- 文法の誤りや、ボタンを押しても何も起きない・結果が出ないなど、動かない箇所がある
- 外部への通信、外部ファイルの読み込み、保存領域・Cookie・alert・window.open を使っている
- 個人を特定できる情報を入力させている
- 架空の統計を事実のように書いている、医療・法律・お金の助言をしている、誰かを傷つける・差別的な内容がある
- 実在の人物・団体について、不正確そうなデータを使っている
- 「${p.solution}」というツールの目的からずれている
問題がなければ {"ok":true,"issues":[]}。
形式: {"ok":true または false,"issues":["問題点"]}`,
    user: html,
    validate: isReview,
  });
}

// ツール本体を書いてチェックし、問題があれば1回だけ直す
// チェックは3つ: コードの決まりごと、AIによるコードの確認、本物のブラウザ（スマホ幅）で動かすテスト
async function buildTool(p: ProjectRow, shotName: string, instruction?: string, prevHtml?: string): Promise<{ html: string; review: Review; test: ToolTest }> {
  let html = await writeToolHtml(p, instruction, prevHtml);
  const check = async (h: string): Promise<{ review: Review; test: ToolTest }> => {
    const [ai, test] = await Promise.all([reviewTool(p, h), testTool(h, shotName)]);
    const issues = [...staticToolIssues(h), ...ai.issues, ...testIssues(test)];
    return { review: { ok: issues.length === 0 && ai.ok, issues }, test };
  };
  let r = await check(html);
  if (!r.review.ok) {
    logEvent(p.id, "ai", "review", `ツールのチェックで問題が見つかったため書き直し: ${r.review.issues.join(" / ")}`);
    html = await writeToolHtml(p, `次の問題を直すこと: ${r.review.issues.join(" / ")}`, html);
    r = await check(html);
  }
  return { html, ...r };
}

// 今の版のツールを、もう一度ブラウザで自動テストする（案件の画面のボタンから）
export async function retestTool(projectId: number): Promise<ToolTest> {
  const p = getProject(projectId);
  const tool = p?.lp ? (JSON.parse(p.lp) as Lp).tool : undefined;
  if (!p || !tool) throw new Error("動くツールの案件ではありません");
  const test = await testTool(tool.html, `p${p.id}-v${p.lp_version}`);
  db().prepare("UPDATE lp_versions SET test = ? WHERE project_id = ? AND version = ?").run(JSON.stringify(test), p.id, p.lp_version);
  const issues = testIssues(test);
  logEvent(p.id, "system", "tool-test", test.skipped ? test.skipped : issues.length ? `自動テストで問題: ${issues.join(" / ")}` : `自動テストで問題なし（${test.clicked}か所を操作）`);
  return test;
}

// ---- LPのデザイン候補を3社で競わせる ----

// 各社に1案ずつ書かせ、伏せ字を付けて3社全員で採点する。1位を返す
async function competeLp(p: ProjectRow): Promise<{ lp: Lp; author: string; label: string; avg: number; count: number }> {
  const authors = ideaAuthors();
  const version = nextVersion(p.id);
  const written = await Promise.all(
    authors.map(async (author) => {
      try {
        const { shareText: _drop, ...lp } = await writeLp(p, undefined, false, author, "LPの候補作成");
        void _drop;
        return { author, lp: lp as Lp };
      } catch (e) {
        logEvent(p.id, "system", "lp-error", `${modelLabel(author)}のLP候補の作成に失敗: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`);
        return null;
      }
    }),
  );
  // 順番を混ぜて伏せ字を付ける（作者の並び順で見抜かれないように）
  const pool = written.filter((x): x is { author: string; lp: Lp } => !!x).sort(() => Math.random() - 0.5);
  if (!pool.length) throw new Error("どのAIからもLPの候補を得られませんでした");
  const insert = db().prepare("INSERT INTO lp_candidates (project_id, version, label, author_model, lp) VALUES (?, ?, ?, ?, ?)");
  const cands = pool.map((x, i) => {
    const label = String.fromCharCode(65 + i);
    const id = Number(insert.run(p.id, version, label, x.author, JSON.stringify(x.lp)).lastInsertRowid);
    return { id, label, ...x, avg: 0 };
  });
  if (cands.length > 1) {
    const sheet = cands.map((c) => `【${c.label}】\n${JSON.stringify(c.lp)}`).join("\n\n");
    const scoreRow = db().prepare("INSERT INTO lp_candidate_scores (candidate_id, scorer_model, score, reason) VALUES (?, ?, ?, ?)");
    await Promise.all(
      authors.map(async (scorer) => {
        try {
          const out = await callJson<{ scores: { label: string; score: number; reason: string }[] }>({
            purpose: "LP候補の採点",
            modelId: scorer,
            projectId: p.id,
            system: `あなたはLP（紹介ページ）の審査員です。同じサービスについて別々の人が作ったLPの案を、作者を知らないまま1〜10点で採点します。
LPは決まった部品で表示されます（design.theme=テーマ色、layout=配置、preview=開発予定の画面イメージ、beforeAfter=使う前後の比較、steps=使い方）。
観点:
- 対象読者（${p.target}）が自分ごとだと感じ、事前登録したくなるか
- 一目で何のサービスか分かるか
- テーマ色・配置・画面イメージなどの見た目の選択が、対象読者と内容に合っているか
- 架空の実績・お客様の声・効果の断言・誇大表現がないか（あれば大きく減点）
点数は甘くしないこと（平凡なものは5点前後）。
形式: {"scores":[{"label":"A","score":1から10の数値,"reason":"理由を1文で"}]}`,
            user: sheet,
            validate: (v): v is { scores: { label: string; score: number; reason: string }[] } =>
              isObj(v) && Array.isArray(v.scores) && v.scores.every((x) => isObj(x) && isStr(x.label) && typeof x.score === "number"),
          });
          for (const sc of out.scores) {
            const c = cands.find((x) => x.label === sc.label.trim().replace(/[【】]/g, ""));
            if (c) scoreRow.run(c.id, scorer, Math.max(1, Math.min(10, sc.score)), typeof sc.reason === "string" ? sc.reason : null);
          }
        } catch (e) {
          logEvent(p.id, "system", "lp-error", `${modelLabel(scorer)}のLP候補の採点に失敗: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`);
        }
      }),
    );
  }
  for (const c of cands) {
    const r = db().prepare("SELECT AVG(score) AS a FROM lp_candidate_scores WHERE candidate_id = ?").get(c.id) as { a: number | null };
    c.avg = r.a ?? 0;
    db().prepare("UPDATE lp_candidates SET avg_score = ? WHERE id = ?").run(c.avg, c.id);
  }
  const top = Math.max(...cands.map((c) => c.avg));
  const tied = cands.filter((c) => Math.abs(c.avg - top) < 1e-9);
  const win = tied[Math.floor(Math.random() * tied.length)];
  db().prepare("UPDATE lp_candidates SET selected = 1 WHERE id = ?").run(win.id);
  logEvent(p.id, "ai", "lp-select", `${cands.length}社のLP候補から、採点の平均が最も高い候補${win.label}（${win.avg.toFixed(1)}点）を選びました`);
  return { lp: win.lp, author: win.author, label: win.label, avg: win.avg, count: cands.length };
}

export function lpCandidates(projectId: number): LpCandidateRow[] {
  return db().prepare("SELECT * FROM lp_candidates WHERE project_id = ? ORDER BY version DESC, label").all(projectId) as LpCandidateRow[];
}

// 公開の承認待ちのあいだだけ、人が別の候補に切り替えられる（切り替えた候補もAIのチェックを通す）
export async function switchLpCandidate(candidateId: number) {
  const c = db().prepare("SELECT * FROM lp_candidates WHERE id = ?").get(candidateId) as LpCandidateRow | undefined;
  if (!c) throw new Error("候補が見つかりません");
  const p = getProject(c.project_id)!;
  const pending = db().prepare("SELECT * FROM approvals WHERE project_id = ? AND kind = 'publish' AND status = 'pending'").get(p.id) as ApprovalRow | undefined;
  if (!pending || p.lp_version !== c.version) throw new Error("公開前の、今の版の候補だけ切り替えられます");
  const lp = normalizeLp(JSON.parse(c.lp));
  const review = await reviewLp(p, lp);
  const conn = db();
  conn.transaction(() => {
    conn.prepare("UPDATE projects SET lp = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(lp), p.id);
    conn.prepare("UPDATE lp_versions SET lp = ?, review = ?, author_model = ?, note = COALESCE(note, '') || ? WHERE project_id = ? AND version = ?")
      .run(JSON.stringify(lp), JSON.stringify(review), c.author_model, `（あなたが候補${c.label}に切り替え）`, p.id, c.version);
    conn.prepare("UPDATE lp_candidates SET human_selected = (id = ?) WHERE project_id = ? AND version = ?").run(c.id, p.id, c.version);
    conn.prepare("UPDATE approvals SET payload = ? WHERE id = ?").run(JSON.stringify({ review }), pending.id);
  })();
  logEvent(p.id, "human", "lp-switch", `LPを候補${c.label}に切り替えました${review.ok ? "" : `（チェックで問題: ${review.issues.join(" / ")}）`}`);
}

// LPを書き、チェックし、問題があれば1回だけ直す。新しい版として保存する
// 動くツールの案件では、ツール本体も作る（改善のときは、指示がツールとページのどちらに向くかをAIの指示文に任せる）
async function buildLpVersion(projectId: number, opts: { instruction?: string; note: string; keepCore?: boolean }) {
  const p = getProject(projectId)!;
  const before = p.lp ? (JSON.parse(p.lp) as Lp) : undefined;
  if (p.kind === "tool") return buildToolVersion(p, before, opts);
  // 最初の版だけは、3社に候補を作らせて、作者を伏せて採点した1位を使う（改善や修正指示のときは1社で直す）
  let author = getSettings().loopModel;
  let note = opts.note;
  let lp: Lp;
  const compete = p.lp_version === 0 && !opts.instruction && !opts.keepCore && ideaAuthors().length > 1;
  if (compete) {
    const won = await competeLp(p);
    lp = won.lp;
    author = won.author;
    note = `${opts.note}（${won.count}社の候補から採点で選択: 候補${won.label}・平均${won.avg.toFixed(1)}点）`;
  } else {
    lp = await writeLp(p, opts.instruction, opts.keepCore);
  }
  let review = await reviewLp(p, lp, opts.keepCore ? before : undefined);
  if (!review.ok) {
    logEvent(projectId, "ai", "review", `チェックで問題が見つかったため書き直し: ${review.issues.join(" / ")}`);
    lp = await writeLp({ ...p, lp: JSON.stringify(lp) }, `次の問題を直すこと: ${review.issues.join(" / ")}`, opts.keepCore, author);
    review = await reviewLp(p, lp, opts.keepCore ? before : undefined);
  }
  const version = nextVersion(p.id);
  const conn = db();
  conn.prepare("UPDATE projects SET lp = ?, lp_version = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(lp), version, projectId);
  conn.prepare("INSERT INTO lp_versions (project_id, version, lp, note, review, author_model) VALUES (?, ?, ?, ?, ?, ?)")
    .run(projectId, version, JSON.stringify(lp), note, JSON.stringify(review), author);
  logEvent(projectId, "ai", "lp", `LPを作成（第${version}版${compete ? "・3社の候補から選択" : ""}）: ${lp.headline}${review.ok ? "" : "（チェックで問題が残っています）"}`);
  return { lp, review, version };
}

async function buildToolVersion(p: ProjectRow, before: Lp | undefined, opts: { instruction?: string; note: string; keepCore?: boolean }) {
  const { shareText, ...page } = await writeLp(p, opts.instruction, opts.keepCore);
  const version = nextVersion(p.id);
  const tool = await buildTool(p, `p${p.id}-v${version}`, opts.instruction, before?.tool?.html);
  const pageReview = await reviewLp(p, page, opts.keepCore ? before : undefined);
  const review: Review = { ok: tool.review.ok && pageReview.ok, issues: [...tool.review.issues, ...pageReview.issues] };
  const lp: Lp = normalizeLp({ ...page, preview: undefined, tool: { html: tool.html, shareText: shareText ?? page.headline } });
  if (!lp.tool) throw new Error("ツールが大きすぎるか空のため保存できませんでした");
  const conn = db();
  conn.prepare("UPDATE projects SET lp = ?, lp_version = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(lp), version, p.id);
  conn.prepare("INSERT INTO lp_versions (project_id, version, lp, note, review, author_model, test) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(p.id, version, JSON.stringify(lp), opts.note, JSON.stringify(review), getSettings().loopModel, JSON.stringify(tool.test));
  logEvent(p.id, "ai", "lp", `ツールと紹介ページを作成（第${version}版・${(tool.html.length / 1000).toFixed(1)}千文字）: ${lp.headline}${review.ok ? "" : "（チェックで問題が残っています）"}`);
  return { lp, review, version };
}

// 新しいLPを作って、公開の承認待ちにする（最初の公開は、どちらのモードでも人が承認する）
// 版の番号は、公開しなかった版も含めて通し番号にする（却下して前の版に戻したあとも重ならないように）
function nextVersion(projectId: number): number {
  const r = db().prepare("SELECT MAX(version) AS v FROM lp_versions WHERE project_id = ?").get(projectId) as { v: number | null };
  return (r.v ?? 0) + 1;
}

export async function prepareLp(projectId: number, instruction?: string, opts: { keepCore?: boolean; byHuman?: boolean } = {}) {
  const p = getProject(projectId)!;
  const note = !instruction ? "最初の版" : opts.byHuman ? `あなたの指示: ${instruction}` : `指示: ${instruction}`;
  const { lp, review } = await buildLpVersion(projectId, { instruction, note, keepCore: opts.keepCore });
  setStage(projectId, "lp");
  // すでに公開中なら、承認されるまでは前の版が公開されたまま
  const replacing = !!p.public_slug && p.public_version !== null;
  addApproval(
    projectId, "publish",
    replacing ? (p.kind === "tool" ? "修正したツールに差し替える" : "修正したLPに差し替える")
    : p.kind === "tool" ? "このツールを公開する" : "このLPを公開して集客を始める",
    replacing
      ? `${instruction ? `指示「${instruction}」で直しました。` : ""}承認すると公開中の第${p.public_version}版と差し替えます。却下すると第${p.public_version}版のまま集客を続けます。${p.kind === "tool" ? "差し替える前に、プレビューでツールを触って確かめてください。" : ""}`
    : p.kind === "tool"
      ? `${p.target}に向けたツールを公開します。公開する前に、プレビューで実際にツールを触って、動くか確かめてください。`
      : `見出し「${lp.headline}」で、${p.target}に向けて事前登録を募ります。`,
    { review },
  );
}

// ---- 3. 判断（続ける / 改善 / 撤退） ----

// 広告費の上限を超えたあとに改善を認めるかのルール（AIへの指示文）
function budgetRule(s: ReturnType<typeof getSettings>): string {
  const cap = s.adBudgetPerProjectJpy;
  const extra = s.improveExtraBudgetJpy;
  return extra > 0
    ? `広告費が上限（${cap}円）に達している場合、collect は選ばない。improve は、改善した版を試すための追加の広告費 ${extra}円（合計 ${cap + extra}円まで）の範囲でだけ認める。合計 ${cap + extra}円にも達している場合は continue か kill を選ぶ。`
    : `広告費が上限（${cap}円）に達している場合は、improve も collect も選ばず、continue か kill のどちらかを選ぶ（上限を超えて広告費を使わないため）。`;
}

function judgePrompt(p: ProjectRow) {
  const s = getSettings();
  const cur = projectTotals(p.id, p.lp_version);
  const all = projectTotals(p.id);
  const history = (db().prepare("SELECT message FROM events WHERE project_id = ? ORDER BY id").all(p.id) as { message: string }[])
    .map((e) => `- ${e.message}`).join("\n");
  const isTool = p.kind === "tool";
  const c = CONV[p.kind];
  const shares = all.rows.reduce((n, r) => n + (r.shares ?? 0), 0);
  return {
    all,
    system: `あなたは事業の撤退判断を担当するアナリストです。${isTool ? "対象は、紹介ページの中ですぐ使える「動くツール」です。" : ""}集客の数字を見て、次のどれかを選びます。
- continue: ${isTool ? "よく使われているので、機能を足す・広めるなど、次の段階へ進む" : "需要が確認できたので、実際にプロダクトを作る段階へ進む"}
- improve: ${isTool ? "反応の兆しはあるので、今すぐツールか紹介ページを1か所変えてもう一度集客する" : "需要の兆しはあるので、今すぐLPを1か所変えてもう一度集客する"}
- collect: 今のLPを変えずに、もう少し集客してから判断する
- kill: 需要が見込めないので撤退する
${budgetRule(s)}
数字が少なすぎて判断できない場合も、その旨を理由に書いたうえで最も妥当なものを選ぶこと。
improve は「今すぐ変える」場合だけに使う。「もう少し様子を見てから変える」なら collect を選ぶこと。
improve の場合、next_action には「LPのどこを、どう変えるか」を1か所だけ、条件を付けずに具体的に書くこと（一度に複数を変えると、何が効いたか分からなくなるため）。
形式: {"decision":"continue|improve|collect|kill","reason":"判断理由（数字を引用）","confidence":0から1,"next_action":"次にやること"}`,
    user: `サービス: ${p.title}（対象: ${p.target}）
仮説: ${p.hypothesis}
今の${isTool ? "版" : "LP"}（第${p.lp_version}版）での結果: 訪問 ${cur.visits}人 / ${c.noun} ${cur.signups}人 / ${c.rate} ${(cur.rate * 100).toFixed(1)}%
全体の結果: 訪問 ${all.visits}人 / ${c.noun} ${all.signups}人 / ${c.rate} ${(all.rate * 100).toFixed(1)}%${isTool ? ` / シェア ${shares}人` : ""} / 広告費 ${all.adSpendJpy}円
目標の${c.rate}: ${(targetRate(p.kind, s) * 100).toFixed(1)}% / 1案件の広告費上限: ${s.adBudgetPerProjectJpy}円 / 上限を超えたあと改善に使える追加の広告費: ${s.improveExtraBudgetJpy}円 / これまでの改善回数: ${p.improve_count}回
これまでの経過:
${history}`,
  };
}

export async function judge(projectId: number) {
  const p = getProject(projectId)!;
  const prompt = judgePrompt(p);
  const d = await callJson<Decision>({ purpose: "判断", projectId, system: prompt.system, user: prompt.user, validate: isDecision });
  logEvent(projectId, "ai", "judge", `判断を提案: ${DECISION_LABEL[d.decision]}`);
  // 同じ数字で何度も判断し直さないよう、判断した時点の訪問数と広告費を覚えておく
  db().prepare("UPDATE projects SET judged_visits = ?, judged_ad_jpy = ? WHERE id = ?").run(prompt.all.visits, prompt.all.adSpendJpy, projectId);

  const approvalId = await applyDecision(p, d, prompt.all.adSpendJpy);
  // 実際の流れを待たせないよう、裏比較は後ろで走らせる
  void shadowJudge(p, d, prompt, approvalId);
}

// AIの判断に従って次へ進める。人の承認待ちを作ったときはその id を返す
async function applyDecision(p: ProjectRow, d: Decision, adSpendJpy: number): Promise<number | null> {
  const s = getSettings();
  const projectId = p.id;

  // 集客を続けるだけなら何も変わらないので、どちらのモードでも承認なしで続ける
  if (d.decision === "collect" && adSpendJpy < s.adBudgetPerProjectJpy) {
    setStage(projectId, "live");
    logEvent(projectId, "system", "collect", `AIの判断により、今のLPのまま集客を続行: ${d.next_action}`);
    return null;
  }

  // 自動モードでは、条件を満たす改善だけ人の承認なしで進める
  if (d.decision === "improve" && p.mode === "auto") {
    // 今の版になってから人が改善を却下していたら、その意思を優先して自動では変えない
    const humanSaidNo = db()
      .prepare("SELECT 1 FROM approvals WHERE project_id = ? AND kind = 'decision' AND status = 'rejected' AND proposal = ? AND lp_version = ?")
      .get(projectId, DECISION_LABEL.improve, p.lp_version);
    const blocked =
      p.kind === "tool" ? "ツールのプログラムの変更は、人が動作を確かめてから公開するため"
      : humanSaidNo ? "この版では人が改善を却下しているため"
      : p.improve_count >= s.maxAutoImprove ? `自動での改善は${s.maxAutoImprove}回までのため`
      : adSpendJpy >= s.adBudgetPerProjectJpy + s.improveExtraBudgetJpy
        ? s.improveExtraBudgetJpy > 0
          ? "広告費が改善用の追加分も含めて上限に達しているため"
          : "広告費が上限に達していて、上限を超えたあとの改善は設定で認められていないため"
      : null;
    if (!blocked) {
      await autoImprove(projectId, d);
      return null;
    }
    logEvent(projectId, "system", "auto-blocked", `${blocked}、人の判断に回します`);
    setStage(projectId, "deciding");
    return addApproval(projectId, "decision", DECISION_LABEL[d.decision], `${d.reason}\n（${blocked}、自動では進めずに判断をお願いしています）`, d);
  }
  setStage(projectId, "deciding");
  return addApproval(projectId, "decision", DECISION_LABEL[d.decision], d.reason, d);
}

// ---- 判断の裏比較 ----
// 実際に使った判断と同じ入力を、他社の上位AIにも渡して答えを記録する（結果は流れに使わない）

export function shadowModels(): string[] {
  const s = getSettings();
  return MODELS.filter((m) => m.tier === "top" && m.id !== s.loopModel && hasKey(m.provider)).map((m) => m.id);
}

async function shadowJudge(p: ProjectRow, primary: Decision, prompt: { system: string; user: string }, approvalId: number | null) {
  const s = getSettings();
  const insert = db().prepare(
    `INSERT INTO shadow_judgments (round_id, project_id, approval_id, lp_version, model_id, is_primary, decision, confidence, reason, next_action, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  // 1回の判断（同じ入力）を1つの「回」としてまとめる。主判断の行の id を回の id にする
  const roundId = Number(
    insert.run(0, p.id, approvalId, p.lp_version, s.loopModel, 1, primary.decision, primary.confidence ?? null, primary.reason, primary.next_action, null).lastInsertRowid,
  );
  db().prepare("UPDATE shadow_judgments SET round_id = ? WHERE id = ?").run(roundId, roundId);
  if (!s.shadowJudge) return;
  await Promise.all(
    shadowModels().map(async (modelId) => {
      try {
        const d = await callJson<Decision>({ purpose: "判断（裏比較）", projectId: p.id, modelId, system: prompt.system, user: prompt.user, validate: isDecision });
        insert.run(roundId, p.id, approvalId, p.lp_version, modelId, 0, d.decision, d.confidence ?? null, d.reason, d.next_action, null);
      } catch (e) {
        insert.run(roundId, p.id, approvalId, p.lp_version, modelId, 0, null, null, null, null, (e instanceof Error ? e.message : String(e)).slice(0, 300));
      }
    }),
  );
  // 人の判断が必要な回だけ、意見が割れていたら議論させる
  if (approvalId && s.debateEnabled) await runDebate(p.id, approvalId, roundId, prompt);
}

// ---- AI同士の議論（意見が割れたときだけ） ----

export type DebatePosition = {
  modelId: string;
  first: Decision["decision"];
  final: Decision["decision"];
  argument: string;
  changed: boolean;
};
export type DebateResult = { positions: DebatePosition[]; issue: string; missing_info: string };
type Rebuttal = { decision: Decision["decision"]; argument: string; changed?: boolean };

const isRebuttal = (v: unknown): v is Rebuttal =>
  isObj(v) && ["continue", "improve", "kill", "collect"].includes(v.decision as string) && isStr(v.argument);

async function runDebate(projectId: number, approvalId: number, roundId: number, prompt: { system: string; user: string }) {
  const rows = (db().prepare("SELECT * FROM shadow_judgments WHERE round_id = ? AND decision IS NOT NULL").all(roundId) as ShadowRow[]);
  const debateId = Number(
    db().prepare("INSERT INTO debates (approval_id, round_id, status) VALUES (?, ?, 'running')").run(approvalId, roundId).lastInsertRowid,
  );
  const setDebate = (status: string, payload?: DebateResult, error?: string) =>
    db().prepare("UPDATE debates SET status = ?, payload = ?, error = ? WHERE id = ?")
      .run(status, payload ? JSON.stringify(payload) : null, error ?? null, debateId);

  if (new Set(rows.map((r) => r.decision)).size <= 1) return setDebate("agreed");

  try {
    const label = (id: string) => MODELS.find((m) => m.id === id)?.label ?? id;
    // 各AIに他のAIの判断と理由を見せて、1回だけ反論・修正させる
    const positions = await Promise.all(
      rows.map(async (r): Promise<DebatePosition> => {
        const others = rows
          .filter((o) => o.model_id !== r.model_id)
          .map((o) => `- ${label(o.model_id)}: ${DECISION_LABEL[o.decision as Decision["decision"]]}（自信度 ${Math.round((o.confidence ?? 0) * 100)}%）理由: ${o.reason}`)
          .join("\n");
        try {
          const out = await callJson<Rebuttal>({
            purpose: "議論",
            projectId,
            modelId: r.model_id,
            system: `${prompt.system}

これは2回目の検討です。他のAIの判断と理由を読んだうえで、もう一度だけ判断してください。
- 相手の主張に納得した場合だけ意見を変える。納得しなければ変えなくてよい（相手に合わせる必要はない）
- 主張には必ず数字を引用する
- argument は相手の意見への反論、または意見を変えた理由を2〜3文で書く
形式: {"decision":"continue|improve|collect|kill","argument":"主張","changed":true または false}`,
            user: `${prompt.user}\n\nあなたの最初の判断: ${DECISION_LABEL[r.decision as Decision["decision"]]} 理由: ${r.reason}\n\n他のAIの判断:\n${others}`,
            validate: isRebuttal,
          });
          return { modelId: r.model_id, first: r.decision as Decision["decision"], final: out.decision, argument: out.argument, changed: out.decision !== r.decision };
        } catch {
          // 反論に失敗したAIは、最初の判断のまま扱う
          return { modelId: r.model_id, first: r.decision as Decision["decision"], final: r.decision as Decision["decision"], argument: r.reason ?? "", changed: false };
        }
      }),
    );
    // 要約は「何が判断を分けているか」と「足りない情報」だけをAIに書かせる（各AIの主張はそのまま載せる）
    const sum = await callJson<{ issue: string; missing_info: string }>({
      purpose: "議論の要約",
      projectId,
      system: `複数のAIの議論を、判断する人のために中立にまとめます。どのAIが正しいかは書かないこと。
- issue: 判断を分けている論点を1〜2文で
- missing_info: 判断をはっきりさせるのに足りない情報や、追加で確かめるとよいことを1〜2文で
形式: {"issue":"論点","missing_info":"足りない情報"}`,
      user: positions.map((x) => `- ${label(x.modelId)}: 最初「${DECISION_LABEL[x.first]}」→ 最終「${DECISION_LABEL[x.final]}」 主張: ${x.argument}`).join("\n"),
      validate: (v): v is { issue: string; missing_info: string } => isObj(v) && isStr(v.issue) && isStr(v.missing_info),
    });
    setDebate("done", { positions, issue: sum.issue, missing_info: sum.missing_info });
    logEvent(projectId, "ai", "debate", `AIの判断が割れたため議論: ${sum.issue}`);
  } catch (e) {
    setDebate("error", undefined, (e instanceof Error ? e.message : String(e)).slice(0, 300));
  }
}

export function debateFor(approvalId: number): { status: string; result: DebateResult | null; error: string | null } | null {
  const r = db().prepare("SELECT * FROM debates WHERE approval_id = ? ORDER BY id DESC LIMIT 1").get(approvalId) as
    { status: string; payload: string | null; error: string | null } | undefined;
  return r ? { status: r.status, result: r.payload ? (JSON.parse(r.payload) as DebateResult) : null, error: r.error } : null;
}

// ---- 人の判断（2段階） ----
// 1. AIの意見を見る前に、数字だけを見て選ぶ（最初の判断）
// 2. AIの意見と議論を見たあとに確定する（最終判断）。ここで初めて実際に進む

export const CHOICES: Decision["decision"][] = ["continue", "improve", "collect", "kill"];

export function setInitialChoice(approvalId: number, choice: string) {
  const a = db().prepare("SELECT * FROM approvals WHERE id = ?").get(approvalId) as ApprovalRow | undefined;
  if (!a || a.kind !== "decision" || a.status !== "pending") throw new Error("判断の承認待ちが見つかりません");
  if (a.initial_choice) throw new Error("最初の判断はすでに記録されています");
  if (!CHOICES.includes(choice as Decision["decision"])) throw new Error("選択が不正です");
  db().prepare("UPDATE approvals SET initial_choice = ? WHERE id = ?").run(choice, approvalId);
  logEvent(a.project_id, "human", "initial-choice", `最初の判断（AIの意見を見る前）: ${DECISION_LABEL[choice as Decision["decision"]]}`);
}

export async function finalizeDecision(approvalId: number, choice: string, comment?: string) {
  const a = db().prepare("SELECT * FROM approvals WHERE id = ?").get(approvalId) as ApprovalRow | undefined;
  if (!a || a.kind !== "decision" || a.status !== "pending") throw new Error("判断の承認待ちが見つかりません");
  if (!a.initial_choice) throw new Error("先に、AIの意見を見る前の判断を選んでください");
  if (!CHOICES.includes(choice as Decision["decision"])) throw new Error("選択が不正です");
  const c = choice as Decision["decision"];
  const proposed = JSON.parse(a.payload ?? "{}") as Decision;
  const status = c === proposed.decision ? "approved" : "overridden";
  db().prepare("UPDATE approvals SET status = ?, final_choice = ?, comment = ?, decided_at = datetime('now') WHERE id = ?")
    .run(status, c, comment ?? null, approvalId);
  const changed = c !== a.initial_choice ? `（最初の判断「${DECISION_LABEL[a.initial_choice as Decision["decision"]]}」から変更）` : "";
  logEvent(a.project_id, "human", "approval", `最終判断: ${DECISION_LABEL[c]}${changed}${comment ? `（${comment}）` : ""}`);

  const pid = a.project_id;
  if (c === "collect") {
    setStage(pid, "live");
    logEvent(pid, "system", "collect", "人の判断により、今のLPのまま集客を続行");
    return;
  }
  if (c === "improve") {
    // 改善点の指示がなければ、改善を主張したAIの案を使う
    const fromAi = proposed.decision === "improve" ? proposed.next_action
      : (db().prepare(`SELECT next_action FROM shadow_judgments WHERE approval_id = ? AND decision = 'improve' LIMIT 1`).get(approvalId) as { next_action: string } | undefined)?.next_action;
    db().prepare("UPDATE projects SET improve_count = improve_count + 1 WHERE id = ?").run(pid);
    return prepareLp(pid, comment?.trim() || fromAi || "登録率が目標に届くよう、見出しを1か所だけ改善する");
  }
  setStage(pid, c === "continue" ? "continued" : "killed");
  if (c === "kill") await closePublic(pid);
  await writeLesson(pid, `${DECISION_LABEL[c]}。AIの提案: ${DECISION_LABEL[proposed.decision]}（${proposed.reason}）`);
}

// 人が実際に選んだ判断。2段階の判断なら最終判断をそのまま使う
// （それ以前の記録は、承認＝AIの提案どおり、却下＝集客を続ける、修正指示＝改善として読む）
function humanChoice(status: string, proposed: string, finalChoice: string | null): Decision["decision"] | null {
  if (finalChoice) return finalChoice as Decision["decision"];
  if (status === "approved") return proposed as Decision["decision"];
  if (status === "rejected") return "collect";
  if (status === "revised") return "improve";
  return null;
}

export type ShadowRow = {
  id: number; round_id: number; at: string; project_id: number; approval_id: number | null; lp_version: number; model_id: string;
  is_primary: number; decision: string | null; confidence: number | null; reason: string | null; next_action: string | null; error: string | null;
};

// 判断1回ごとに、各AIの答えと人の選択を並べる
export function shadowRounds() {
  const rows = db().prepare("SELECT * FROM shadow_judgments ORDER BY id").all() as ShadowRow[];
  const rounds = new Map<number, ShadowRow[]>();
  for (const r of rows) {
    if (!rounds.has(r.round_id)) rounds.set(r.round_id, []);
    rounds.get(r.round_id)!.push(r);
  }
  return [...rounds.values()].map((rs) => {
    const primary = rs.find((r) => r.is_primary) ?? rs[0];
    const a = primary.approval_id
      ? (db().prepare("SELECT status, payload, initial_choice, final_choice FROM approvals WHERE id = ?").get(primary.approval_id) as
        { status: string; payload: string | null; initial_choice: string | null; final_choice: string | null } | undefined)
      : undefined;
    const human = a ? humanChoice(a.status, (JSON.parse(a.payload ?? "{}") as Decision).decision, a.final_choice) : null;
    const initial = (a?.initial_choice ?? null) as Decision["decision"] | null;
    const debate = primary.approval_id ? debateFor(primary.approval_id) : null;
    const p = getProject(primary.project_id);
    return { at: primary.at, project: p ? { id: p.id, title: p.title, demo: !!p.demo } : null, lpVersion: primary.lp_version, primary, rows: rs, human, initial, debated: debate?.status === "done" };
  }).reverse();
}

// AIごとの成績: 担当AIとの一致率、人の選択との一致率
export function shadowScores() {
  // デモ案件の判断は成績に含めない
  const rounds = shadowRounds().filter((r) => r.project && !r.project.demo);
  const models = [...new Set(rounds.flatMap((r) => r.rows.map((x) => x.model_id)))];
  return models.map((modelId) => {
    const mine = rounds.map((r) => ({ r, row: r.rows.find((x) => x.model_id === modelId) })).filter((x) => x.row && x.row.decision);
    const vsPrimary = mine.filter((x) => !x.row!.is_primary);
    const withHuman = mine.filter((x) => x.r.human);
    const withInitial = mine.filter((x) => x.r.initial);
    return {
      agreeInitial: withInitial.length ? withInitial.filter((x) => x.row!.decision === x.r.initial).length / withInitial.length : null,
      agreeInitialN: withInitial.length,
      modelId,
      judged: mine.length,
      errors: rounds.filter((r) => r.rows.find((x) => x.model_id === modelId && x.error)).length,
      wasPrimary: mine.filter((x) => x.row!.is_primary).length,
      agreePrimary: vsPrimary.length ? vsPrimary.filter((x) => x.row!.decision === x.r.primary.decision).length / vsPrimary.length : null,
      agreePrimaryN: vsPrimary.length,
      agreeHuman: withHuman.length ? withHuman.filter((x) => x.row!.decision === x.r.human).length / withHuman.length : null,
      agreeHumanN: withHuman.length,
      avgConfidence: mine.length ? mine.reduce((s, x) => s + (x.row!.confidence ?? 0), 0) / mine.length : null,
    };
  });
}

// 議論が人の判断を変えたか: 2段階で判断した回について、最初と最終を比べる
export function debateStats() {
  const rounds = shadowRounds().filter((r) => r.project && !r.project.demo && r.initial && r.human);
  const debated = rounds.filter((r) => r.debated);
  const quiet = rounds.filter((r) => !r.debated);
  return {
    decided: rounds.length,
    debated: debated.length,
    changedAfterDebate: debated.filter((r) => r.initial !== r.human).length,
    changedWithoutDebate: quiet.filter((r) => r.initial !== r.human).length,
    quiet: quiet.length,
  };
}

async function autoImprove(projectId: number, d: Decision) {
  const { version, review } = await buildLpVersion(projectId, { instruction: d.next_action, note: `自動改善: ${d.next_action}`, keepCore: true });
  if (!review.ok) {
    // チェックを通らない改善は公開せず、人に回す
    setStage(projectId, "lp");
    addApproval(projectId, "publish", "改善したLPを公開する", `AIのチェックで問題が残ったため、自動公開を止めました: ${review.issues.join(" / ")}`, { review });
    return;
  }
  db().prepare("UPDATE projects SET improve_count = improve_count + 1 WHERE id = ?").run(projectId);
  setStage(projectId, "live");
  logEvent(projectId, "system", "auto-improve", `自動でLPを改善し、第${version}版で集客を再開（人の承認なし）`);
  // すでに公開中なら、新しい版に差し替える
  if (getProject(projectId)!.public_slug) await announcePublish(projectId);
}

// ---- 4. 教訓メモ ----

async function writeLesson(projectId: number, outcome: string) {
  const p = getProject(projectId)!;
  const t = projectTotals(projectId);
  const out = await callJson<{ lesson: string }>({
    purpose: "教訓メモ",
    projectId,
    system: `終わった案件から、次のアイデア出しに活かせる教訓を1〜2文で書きます。この案件だけの話ではなく、次に一般化できる形にすること。
形式: {"lesson":"教訓"}`,
    user: `サービス: ${p.title}（対象: ${p.target}）\n結果: ${outcome}\n形: ${KIND_LABEL[p.kind]}\n訪問 ${t.visits}人 / ${CONV[p.kind].noun} ${t.signups}人 / ${CONV[p.kind].rate} ${(t.rate * 100).toFixed(1)}% / 改善 ${p.improve_count}回`,
    validate: (v): v is { lesson: string } => isObj(v) && isStr(v.lesson),
  });
  db().prepare("INSERT INTO lessons (project_id, text) VALUES (?, ?)").run(projectId, out.lesson);
  logEvent(projectId, "ai", "lesson", `教訓を記録: ${out.lesson}`);
}

// ---- 人間の承認 ----

export type ApprovalAction = "approve" | "reject" | "revise";

export async function decide(approvalId: number, action: ApprovalAction, comment?: string) {
  const a = db().prepare("SELECT * FROM approvals WHERE id = ?").get(approvalId) as ApprovalRow | undefined;
  if (!a) throw new Error("承認リクエストが見つかりません");
  if (a.status !== "pending") throw new Error("この承認リクエストは処理済みです");
  if (action === "revise" && !comment?.trim()) throw new Error("修正指示を書いてください");

  const status = action === "approve" ? "approved" : action === "reject" ? "rejected" : "revised";
  db().prepare("UPDATE approvals SET status = ?, comment = ?, decided_at = datetime('now') WHERE id = ?").run(status, comment ?? null, approvalId);
  const verb = { approve: "承認", reject: "却下", revise: "修正指示" }[action];
  logEvent(a.project_id, "human", "approval", `${verb}: ${a.proposal}${comment ? `（${comment}）` : ""}`);

  const pid = a.project_id;
  if (a.kind === "idea") {
    if (action === "reject") return setStage(pid, "rejected");
    return prepareLp(pid, action === "revise" ? comment : undefined);
  }
  if (a.kind === "publish") {
    if (action === "reject") return rejectPublish(pid);
    if (action === "revise") return prepareLp(pid, comment);
    setStage(pid, "live");
    await announcePublish(pid);
    return;
  }
  // decision
  if (action === "reject") {
    setStage(pid, "live");
    logEvent(pid, "system", "continue-collecting", "AIの判断を採用せず、集客を続ける");
    return;
  }
  const d = JSON.parse(a.payload ?? "{}") as Decision;
  if (action === "approve" && d.decision === "collect") {
    // 広告費の上限に達した状態で集客を続けるので、上限を超えて使うことを人が認めたことになる
    setStage(pid, "live");
    logEvent(pid, "system", "collect", "承認により、広告費の上限を超えて今のLPのまま集客を続行");
    return;
  }
  if (action === "revise" || d.decision === "improve") {
    db().prepare("UPDATE projects SET improve_count = improve_count + 1 WHERE id = ?").run(pid);
    return prepareLp(pid, action === "revise" ? comment : d.next_action);
  }
  setStage(pid, d.decision === "continue" ? "continued" : "killed");
  if (d.decision === "kill") await closePublic(pid);
  await writeLesson(pid, `${DECISION_LABEL[d.decision]}。理由: ${d.reason}`);
}

// 公開の却下: 公開中の版があれば、その版に戻して集客を続ける。まだ一度も公開していなければ見送り
function rejectPublish(pid: number) {
  const p = getProject(pid)!;
  if (!p.public_slug || p.public_version === null) return setStage(pid, "rejected");
  const live = db().prepare("SELECT lp FROM lp_versions WHERE project_id = ? AND version = ?").get(pid, p.public_version) as { lp: string } | undefined;
  if (!live) return setStage(pid, "rejected");
  db().prepare("UPDATE lp_versions SET note = COALESCE(note, '') || '（却下・公開せず）' WHERE project_id = ? AND version = ?").run(pid, p.lp_version);
  db().prepare("UPDATE projects SET lp = ?, lp_version = ?, updated_at = datetime('now') WHERE id = ?").run(live.lp, p.public_version, pid);
  setStage(pid, "live");
  logEvent(pid, "system", "revert", `第${p.lp_version}版は公開せず、公開中の第${p.public_version}版のまま集客を続けます`);
}

// 案件の画面から、今のLP・ツールへの修正を指示する。作った版は、承認されるまで公開しない
export async function requestRevision(projectId: number, instruction: string, keepCore: boolean) {
  const p = getProject(projectId);
  if (!p?.lp) throw new Error("まだLPやツールがありません");
  if (!["lp", "live"].includes(p.stage)) throw new Error("作成中か集客中の案件だけ修正できます");
  const pending = db().prepare("SELECT * FROM approvals WHERE project_id = ? AND status = 'pending'").all(projectId) as ApprovalRow[];
  if (pending.some((a) => a.kind !== "publish")) throw new Error("ほかの承認待ちがあります。先にそちらを処理してください");
  // 公開の承認待ちがあれば、それに修正指示を出したことにする
  for (const a of pending) {
    db().prepare("UPDATE approvals SET status = 'revised', comment = ?, decided_at = datetime('now') WHERE id = ?").run(instruction, a.id);
  }
  logEvent(projectId, "human", "revise-request", `修正を指示: ${instruction}${keepCore ? "（指示した所だけ変える）" : ""}`);
  await prepareLp(projectId, instruction, { keepCore, byHuman: true });
}

// 撤退した案件の登録者への連絡が済んだ: メールアドレスを消して、済みにする
export async function finishNotify(projectId: number): Promise<number> {
  const p = getProject(projectId);
  if (!p?.public_slug || p.notify_status !== "pending") throw new Error("連絡が必要な案件ではありません");
  const n = await deleteSignups(p.public_slug);
  db().prepare("UPDATE projects SET notify_status = 'done' WHERE id = ?").run(projectId);
  logEvent(projectId, "human", "notify-done", `登録者に連絡し、メールアドレス${n}件を削除しました`);
  return n;
}

// ---- 集客データ ----

export async function addMetrics(projectId: number, rows: { day: string; visits: number; signups: number; shares?: number; adSpendJpy: number; source: "manual" | "simulated" }[]) {
  const p = getProject(projectId);
  if (p?.stage !== "live") throw new Error("集客データを追加できるのは「集客中」の案件だけです");
  const insert = db().prepare("INSERT INTO metrics (project_id, day, visits, signups, shares, ad_spend_jpy, source, lp_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  for (const r of rows) insert.run(projectId, r.day, r.visits, r.signups, r.shares ?? 0, r.adSpendJpy, r.source, p.lp_version);
  const added = rows.reduce((s, r) => s + r.visits, 0);
  logEvent(projectId, "system", "metrics", `集客データを追加: 訪問 +${added}人（第${p.lp_version}版・${rows[0]?.source === "simulated" ? "シミュレーション" : "手入力"}）`);
  return maybeAutoJudge(projectId);
}

// 次のどちらかで、自動でAIに判断させる
// - 今の版の訪問が基準を超え、かつ前回の判断から基準の半分以上の訪問が増えた
// - 広告費が上限、または「上限＋改善用の追加分」に達した（その線を越えてからはまだ判断していない）
// ---- 公開用LPサイトとのつなぎ ----

// 公開の承認・自動改善のあと: 公開用サイトにLPを載せる。設定がなければ手動公開の前提で記録だけ残す
async function announcePublish(projectId: number) {
  const p = getProject(projectId)!;
  try {
    if (await publishLp(p)) {
      logEvent(projectId, "system", "publish", `第${p.lp_version}版のLPを公開しました: ${publicUrl(projectId) ?? slugOf(projectId)}`);
      return;
    }
  } catch (e) {
    logEvent(projectId, "system", "publish-error", (e instanceof Error ? e.message : String(e)).slice(0, 300));
    return;
  }
  logEvent(projectId, "system", "publish", `第${p.lp_version}版のLPで集客を開始（公開用サイトが未設定のため、手動で公開する前提）`);
}

async function closePublic(projectId: number) {
  const p = getProject(projectId)!;
  // 事前登録してくれた人がいれば、連絡してメールアドレスを消すまでを「やること」に残す
  if (p.kind === "lp" && projectTotals(projectId).signups > 0) {
    db().prepare("UPDATE projects SET notify_status = 'pending' WHERE id = ?").run(projectId);
    logEvent(projectId, "system", "notify-pending", "事前登録してくれた人への連絡と、メールアドレスの削除が必要です");
  }
  try {
    if (await closeLp(p)) logEvent(projectId, "system", "close", "公開中のLPの受付を終了しました");
  } catch (e) {
    logEvent(projectId, "system", "publish-error", (e instanceof Error ? e.message : String(e)).slice(0, 300));
  }
}

// 本物の訪問・登録を取り込み、基準に達した案件はAIに判断させる
export async function syncAndJudge() {
  const r = await syncRealMetrics();
  const live = db().prepare("SELECT id FROM projects WHERE stage = 'live' AND public_slug IS NOT NULL AND demo = 0").all() as { id: number }[];
  let judged = 0;
  for (const { id } of live) if (await maybeAutoJudge(id)) judged++;
  return { ...r, judged };
}

export async function maybeAutoJudge(projectId: number) {
  const p = getProject(projectId)!;
  const pending = db().prepare("SELECT COUNT(*) AS n FROM approvals WHERE project_id = ? AND status = 'pending'").get(projectId) as { n: number };
  if (p.stage !== "live" || pending.n > 0) return false;
  const s = getSettings();
  const all = projectTotals(projectId);
  const enoughVisits =
    projectTotals(projectId, p.lp_version).visits >= s.judgeMinVisits && all.visits - p.judged_visits >= s.judgeMinVisits / 2;
  // 上限と「上限＋改善用の追加分」の2つの線のどちらかを、前回の判断のあとで越えたら判断する
  const lines = [s.adBudgetPerProjectJpy, s.adBudgetPerProjectJpy + s.improveExtraBudgetJpy];
  const budgetHit = lines.some((line) => all.adSpendJpy >= line && p.judged_ad_jpy < line);
  if (!enoughVisits && !budgetHit) return false;
  await judge(projectId);
  return true;
}

// 広告を出さずに流れを試すための、ダミーの集客データ
export function simulatedDays(project: ProjectRow, days: number) {
  const seed = (n: number) => {
    const x = Math.sin(project.id * 9973 + n * 7919) * 10000;
    return x - Math.floor(x);
  };
  // AIの自信度を「本当の需要」のぶれた推定とみなし、LPを改善するたびに少しだけ上がることにする
  // 動くツールは、その場で使えるので成果の割合がずっと高い
  const scale = project.kind === "tool" ? 0.6 : 0.06;
  const base = (project.ai_confidence ?? 0.5) * scale + (seed(0) - 0.5) * scale * 0.66;
  const trueRate = Math.max(0.005, base + project.improve_count * 0.005);
  const done = (db().prepare("SELECT COUNT(*) AS n FROM metrics WHERE project_id = ?").get(project.id) as { n: number }).n;
  return Array.from({ length: days }, (_, i) => {
    const visits = 15 + Math.round(seed(done + i + 1) * 35);
    const signups = Array.from({ length: visits }, (_, k) => seed(1000 + (done + i) * 100 + k) < trueRate).filter(Boolean).length;
    const day = new Date(Date.now() - (days - i - 1) * 86400000).toISOString().slice(0, 10);
    const shares = project.kind === "tool" ? Math.round(signups * 0.1 * seed(5000 + done + i) * 2) : 0;
    return { day, visits, signups, shares, adSpendJpy: visits * 100, source: "simulated" as const };
  });
}

// ---- 5. 毎日の自動実行 ----

export type DailyResult = { ran: boolean; message: string; projectIds: number[] };

const gDaily = globalThis as unknown as { __aiLabDailyRunning?: boolean };

export async function runDaily({ force = false } = {}): Promise<DailyResult> {
  if (gDaily.__aiLabDailyRunning) return { ran: false, message: "すでに実行中です", projectIds: [] };
  gDaily.__aiLabDailyRunning = true;
  try {
    const s = getSettings();
    if (s.killSwitch) return skip("緊急停止中のため休みました");
    if (!force && s.lastDailyRun === today()) return { ran: false, message: "今日はもう実行済みです", projectIds: [] };

    expireStale(s.staleDays);
    // デモ案件の承認待ちは数えない
    const pending = (db()
      .prepare("SELECT COUNT(*) AS n FROM approvals a JOIN projects p ON p.id = a.project_id WHERE a.status = 'pending' AND p.demo = 0")
      .get() as { n: number }).n;
    const live = (db().prepare("SELECT COUNT(*) AS n FROM projects WHERE stage = 'live' AND demo = 0").get() as { n: number }).n;
    if (pending >= s.maxPending) return skip(`承認待ちが${pending}件たまっているため、アイデア出しを休みました（上限${s.maxPending}件）`);
    if (live >= s.maxLive) return skip(`集客中の案件が${live}件あるため、アイデア出しを休みました（上限${s.maxLive}件）`);

    const { candidates, kept } = await gatherAndScoreIdeas(s.dailyIdeaCount, s.dailyKeep);
    if (!candidates.length) return skip("どのAIからもアイデアを得られなかったため休みました");
    const ids: number[] = [];
    for (const c of kept) {
      // 承認するときに作者が分からないよう、ここでは作者名を出さない
      // 作者の自己申告は甘くなりがちなので、他社の採点の平均を自信として使う
      const conf = c.peerAvg !== null ? { value: c.peerAvg / 10, source: "他社のAIによる採点の平均" } : selfConfidence(c.idea);
      const id = insertProject(c.idea, "", { ...nextMode(conf), confidence: conf.value }, "daily", c.author);
      db().prepare("UPDATE idea_candidates SET selected = 1, project_id = ? WHERE id = ?").run(id, c.id);
      logEvent(id, "ai", "select", `${candidates.length}件の候補から選ばれました（3社のAIによる採点の平均 ${c.avg.toFixed(1)}点 / 10点）`);
      ids.push(id);
      await startProject(id);
    }
    for (const c of candidates.filter((x) => !kept.includes(x))) {
      logEvent(null, "ai", "idea-skipped", `アイデア「${c.idea.title}」を見送り（${modelLabel(c.author)}の案・平均 ${c.avg.toFixed(1)}点）`);
    }
    saveSettings({ lastDailyRun: today() });
    logEvent(null, "system", "daily", `毎日の自動実行: 3社のAIが出した${candidates.length}件の候補から${ids.length}件を進めました`);
    return { ran: true, message: `${candidates.length}件の候補から${ids.length}件を進めました`, projectIds: ids };
  } finally {
    gDaily.__aiLabDailyRunning = false;
  }

  function skip(message: string): DailyResult {
    saveSettings({ lastDailyRun: today() });
    logEvent(null, "system", "daily", `毎日の自動実行: ${message}`);
    return { ran: false, message, projectIds: [] };
  }
}

// ---- 3社でアイデアを出し、作者を伏せて全員で採点する ----

type Candidate = { id: number; label: string; author: string; idea: Idea; avg: number; peerAvg: number | null };

const modelLabel = (id: string) => MODELS.find((m) => m.id === id)?.label ?? id;

// アイデアを出すAI: 各社の上位モデル（キーがあるもの）
export function ideaAuthors(): string[] {
  return MODELS.filter((m) => m.tier === "top" && hasKey(m.provider)).map((m) => m.id);
}

async function gatherAndScoreIdeas(perModel: number, keep: number): Promise<{ candidates: Candidate[]; kept: Candidate[] }> {
  const authors = ideaAuthors();
  const batchId = `${Date.now()}`;

  // 1. 各社にアイデアを出させる（失敗したAIは飛ばす）
  const results = await Promise.all(
    authors.map(async (author) => {
      try {
        return (await askIdeas("", perModel, author)).map((idea) => ({ author, idea }));
      } catch (e) {
        logEvent(null, "system", "idea-error", `${modelLabel(author)}のアイデア出しに失敗: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`);
        return [];
      }
    }),
  );
  // 2. 順番を混ぜて、A, B, C... の伏せ字を付ける（作者の並び順で見抜かれないように）
  const pool = results.flat().sort(() => Math.random() - 0.5);
  if (!pool.length) return { candidates: [], kept: [] };
  const insert = db().prepare("INSERT INTO idea_candidates (batch_id, label, author_model, title, payload) VALUES (?, ?, ?, ?, ?)");
  const candidates: Candidate[] = pool.map((x, i) => {
    const label = String.fromCharCode(65 + i);
    const id = Number(insert.run(batchId, label, x.author, x.idea.title, JSON.stringify(x.idea)).lastInsertRowid);
    return { id, label, author: x.author, idea: x.idea, avg: 0, peerAvg: null };
  });

  // 3. 各社が、作者を伏せた全候補に点を付ける
  const sheet = candidates
    .map((c) => `【${c.label}】${c.idea.title}（形: ${c.idea.kind === "tool" ? "tool" : "lp"}）\n対象: ${c.idea.target}\n課題: ${c.idea.problem}\n解決策: ${c.idea.solution}\n仮説: ${c.idea.hypothesis}`)
    .join("\n\n");
  const scoreRow = db().prepare("INSERT INTO idea_scores (candidate_id, scorer_model, score, reason) VALUES (?, ?, ?, ?)");
  await Promise.all(
    authors.map(async (scorer) => {
      try {
        const out = await callJson<{ scores: { label: string; score: number; reason: string }[] }>({
          purpose: "アイデアの採点",
          modelId: scorer,
          system: `あなたは事業アイデアの審査員です。作者が誰かは分かりません。次の観点で各アイデアを1〜10点で採点します。
- 対象者が具体的で、その人に安く届けられるか
- 困りごと・欲しい気持ちが強く、事前登録したくなるか（形が tool なら、使ってシェアしたくなるか）
- 選んだ形（lp=事前登録LP / tool=1ページで完結する動くツール）が、そのアイデアに合っているか。tool なら外部の通信なしで本当に作れるか
- 既存の無料サービスとの違いがはっきりしているか
点数は甘くしないこと（平凡なものは5点前後）。
形式: {"scores":[{"label":"A","score":1から10の数値,"reason":"理由を1文で"}]}`,
          user: sheet,
          validate: (v): v is { scores: { label: string; score: number; reason: string }[] } =>
            isObj(v) && Array.isArray(v.scores) && v.scores.every((x) => isObj(x) && isStr(x.label) && typeof x.score === "number"),
        });
        for (const sc of out.scores) {
          const c = candidates.find((x) => x.label === sc.label.trim().replace(/[【】]/g, ""));
          if (c) scoreRow.run(c.id, scorer, Math.max(1, Math.min(10, sc.score)), typeof sc.reason === "string" ? sc.reason : null);
        }
      } catch (e) {
        logEvent(null, "system", "idea-error", `${modelLabel(scorer)}の採点に失敗: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`);
      }
    }),
  );

  // 4. 平均点で並べる。同点なら、まだ選ばれていない作者のものを優先する
  for (const c of candidates) {
    const r = db().prepare("SELECT AVG(score) AS a FROM idea_scores WHERE candidate_id = ?").get(c.id) as { a: number | null };
    c.avg = r.a ?? 0;
    const peer = db().prepare("SELECT AVG(score) AS a FROM idea_scores WHERE candidate_id = ? AND scorer_model != ?").get(c.id, c.author) as { a: number | null };
    c.peerAvg = peer.a;
    db().prepare("UPDATE idea_candidates SET avg_score = ? WHERE id = ?").run(c.avg, c.id);
  }
  const kept: Candidate[] = [];
  const rest = [...candidates].sort((a, b) => b.avg - a.avg);
  while (kept.length < keep && rest.length) {
    const top = rest[0].avg;
    const tied = rest.filter((c) => Math.abs(c.avg - top) < 1e-9);
    const pick = tied.find((c) => !kept.some((k) => k.author === c.author)) ?? tied[0];
    kept.push(pick);
    rest.splice(rest.indexOf(pick), 1);
  }
  return { candidates, kept };
}

// LPのデザイン候補の作者別の成績: 他社からの点、自分の案への点、AIに選ばれた数、人が切り替えた数、
// その作者のLPで集めた実際の登録率（公開の判断が済んだ案件だけ。承認待ちの案件では作者を伏せているため）
export function designAuthorStats() {
  const rows = db()
    .prepare(
      `SELECT c.* FROM lp_candidates c JOIN projects p ON p.id = c.project_id
       WHERE p.demo = 0 AND NOT EXISTS (SELECT 1 FROM approvals a WHERE a.project_id = c.project_id AND a.kind = 'publish' AND a.status = 'pending')`,
    )
    .all() as LpCandidateRow[];
  const authors = [...new Set(rows.map((r) => r.author_model))];
  return authors.map((author) => {
    const mine = rows.filter((r) => r.author_model === author);
    const ids = mine.map((r) => r.id).join(",") || "NULL";
    const fromOthers = db().prepare(`SELECT AVG(score) AS a FROM lp_candidate_scores WHERE candidate_id IN (${ids}) AND scorer_model != ?`).get(author) as { a: number | null };
    const fromSelf = db().prepare(`SELECT AVG(score) AS a FROM lp_candidate_scores WHERE candidate_id IN (${ids}) AND scorer_model = ?`).get(author) as { a: number | null };
    // 実際に使われた版（この作者が書いた版）の成果
    const used = db()
      .prepare("SELECT v.project_id, v.version FROM lp_versions v JOIN projects p ON p.id = v.project_id WHERE p.demo = 0 AND p.kind = 'lp' AND v.author_model = ?")
      .all(author) as { project_id: number; version: number }[];
    const totals = used.map((u) => projectTotals(u.project_id, u.version)).filter((t) => t.visits > 0);
    const visits = totals.reduce((n, t) => n + t.visits, 0);
    const signups = totals.reduce((n, t) => n + t.signups, 0);
    return {
      author,
      candidates: mine.length,
      aiSelected: mine.filter((r) => r.selected).length,
      humanSelected: mine.filter((r) => r.human_selected).length,
      scoreFromOthers: fromOthers.a,
      scoreFromSelf: fromSelf.a,
      rate: visits ? signups / visits : null,
      visits,
    };
  });
}

// 作者別の成績: 他社からの点、自分の案への点、選ばれた数、人の採用、実際の登録率
export function ideaAuthorStats() {
  const authors = [...new Set((db().prepare("SELECT DISTINCT author_model AS a FROM idea_candidates").all() as { a: string }[]).map((r) => r.a))];
  return authors.map((author) => {
    const cands = db().prepare("SELECT * FROM idea_candidates WHERE author_model = ?").all(author) as { id: number; selected: number; project_id: number | null }[];
    const ids = cands.map((c) => c.id).join(",") || "NULL";
    const fromOthers = db().prepare(`SELECT AVG(score) AS a, COUNT(*) AS n FROM idea_scores WHERE candidate_id IN (${ids}) AND scorer_model != ?`).get(author) as { a: number | null; n: number };
    const fromSelf = db().prepare(`SELECT AVG(score) AS a FROM idea_scores WHERE candidate_id IN (${ids}) AND scorer_model = ?`).get(author) as { a: number | null };
    // この作者が他社の案に付けた点（自分の案への点と比べて、身内びいきかを見る）
    const givenToOthers = db()
      .prepare("SELECT AVG(s.score) AS a FROM idea_scores s JOIN idea_candidates c ON c.id = s.candidate_id WHERE s.scorer_model = ? AND c.author_model != ?")
      .get(author, author) as { a: number | null };
    const projectIds = cands.filter((c) => c.project_id).map((c) => c.project_id!) ;
    const decided = projectIds.length
      ? (db().prepare(`SELECT status FROM approvals WHERE kind = 'idea' AND status IN ('approved','rejected','revised') AND project_id IN (${projectIds.join(",")})`).all() as { status: string }[])
      : [];
    const traffic = projectIds.map((id) => projectTotals(id)).filter((t) => t.visits > 0);
    const visits = traffic.reduce((s, t) => s + t.visits, 0);
    const signups = traffic.reduce((s, t) => s + t.signups, 0);
    return {
      author,
      candidates: cands.length,
      selected: cands.filter((c) => c.selected).length,
      scoreFromOthers: fromOthers.a,
      scoreFromSelf: fromSelf.a,
      scoreGivenToOthers: givenToOthers.a,
      humanApproved: decided.filter((d) => d.status !== "rejected").length,
      humanDecided: decided.length,
      rate: visits ? signups / visits : null,
      projectsWithTraffic: traffic.length,
    };
  });
}

function expireStale(days: number) {
  const stale = db()
    .prepare(`SELECT * FROM approvals WHERE status = 'pending' AND created_at < datetime('now', ?)`)
    .all(`-${days} days`) as ApprovalRow[];
  for (const a of stale) {
    db().prepare("UPDATE approvals SET status = 'expired', decided_at = datetime('now') WHERE id = ?").run(a.id);
    // 判断待ちを放置した場合は集客を続け、それ以外は見送りにする
    setStage(a.project_id, a.kind === "decision" ? "live" : "rejected");
    logEvent(a.project_id, "system", "expired", `${days}日間承認されなかったため「${a.proposal}」を${a.kind === "decision" ? "保留して集客を継続" : "見送り"}にしました`);
  }
}

// ---- モード別の比較 ----

export function modeComparison() {
  const projects = db().prepare("SELECT * FROM projects WHERE demo = 0").all() as ProjectRow[];
  return (["manual", "auto"] as const).map((mode) => {
    const mine = projects.filter((p) => p.mode === mode);
    const ids = mine.map((p) => p.id);
    const inList = ids.length ? ids.join(",") : "NULL";
    const approvals = (db().prepare(`SELECT COUNT(*) AS n FROM approvals WHERE status IN ('approved','rejected','revised') AND project_id IN (${inList})`).get() as { n: number }).n;
    const cost = (db().prepare(`SELECT COALESCE(SUM(cost_usd), 0) AS s FROM ai_calls WHERE project_id IN (${inList})`).get() as { s: number }).s;
    const reviewIssues = (db().prepare(`SELECT COUNT(*) AS n FROM lp_versions WHERE project_id IN (${inList}) AND review LIKE '%"ok":false%'`).get() as { n: number }).n;
    const withTraffic = mine.map((p) => projectTotals(p.id)).filter((t) => t.visits > 0);
    const visits = withTraffic.reduce((s, t) => s + t.visits, 0);
    const signups = withTraffic.reduce((s, t) => s + t.signups, 0);
    return {
      mode,
      projects: mine.length,
      humanApprovals: approvals,
      approvalsPerProject: mine.length ? approvals / mine.length : 0,
      improvements: mine.reduce((s, p) => s + p.improve_count, 0),
      reviewIssues,
      rate: visits ? signups / visits : null,
      continued: mine.filter((p) => p.stage === "continued").length,
      killed: mine.filter((p) => p.stage === "killed").length,
      costUsd: cost,
    };
  });
}
