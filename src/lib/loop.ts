import { viralHints } from "./viralPosts";
import { getWant, wantsText } from "./userWants";
import { callJson, callLong, claudeModelId, isObj, isStr } from "./ai";
import { DESIGN_OPTIONS, ICONS, PREVIEW_KINDS, SECTIONS, THEMES, TOOL_HTML_MAX, isLpCore, normalizeLp, type Lp } from "../../lp-site/src/lp/content";
import { MODELS, hasKey, modelInfo } from "./models";
import { testIssues, testTool, type ToolTest } from "./toolTest";
import { seasonalContext } from "./season";
import { trendsText } from "./trends";
import { withIllustration } from "./illustration";
import { buildPage, judgePages, pageTexts, type PageCheck } from "./freePage";
import { funnelText } from "./funnel";
import { planIdeaNote, planPausesNew } from "./plan";
import { EXTRAS_RULE, addProposal, takeExtras } from "./voices";
import { outsideText, recordVoiceEffects } from "./outside";
import { budgetState } from "./budget";
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
  channel?: string; // 最初の利用者がいる場所（どこで、どう届けるか）
  first_test?: string; // 最初の1週間で、何人に届けて何を確かめるか
  season?: "seasonal" | "evergreen"; // 季節もの（その時期だけ）か、1年中ある困りごとか
  want_id?: number; // 元にした「欲しい」の声（user_wants）の番号
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
  decision: "continue" | "improve" | "kill" | "collect" | "rethink";
  reason: string;
  confidence: number;
  next_action: string;
};

export type Review = { ok: boolean; issues: string[] };

export const STAGE_LABEL: Record<Stage, string> = {
  idea: "アイデア",
  lp: "作成",
  live: "集客中",
  deciding: "判断待ち",
  continued: "継続",
  killed: "撤退",
  rejected: "見送り",
};

export const MODE_LABEL = { manual: "毎回承認", auto: "自動で進める" } as const;

export const DECISION_LABEL: Record<Decision["decision"], string> = {
  continue: "続ける（育てる段階へ）",
  improve: "改善して再挑戦",
  kill: "撤退する",
  collect: "今のまま集客を続ける",
  rethink: "集客を見直す（ページは変えない）",
};

const isIdea = (v: unknown): v is Idea =>
  isObj(v) && ["title", "target", "problem", "solution", "hypothesis", "reason"].every((k) => isStr(v[k]));

const isLp = (v: unknown): v is Lp => isLpCore(v);

const isDecision = (v: unknown): v is Decision =>
  isObj(v) && ["continue", "improve", "kill", "collect", "rethink"].includes(v.decision as string) && isStr(v.reason) && isStr(v.next_action);

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

// AIが作業中の案件（このサーバーの中だけで持つ。途中でサーバーが止まると消えるので、そのときは「止まっている」扱いになる）
const gBuilding = globalThis as unknown as { __aiLabBuilding?: Map<number, { what: string; since: number }> };
const building = (gBuilding.__aiLabBuilding ??= new Map());

// ライブ画面用: AIの途中経過（届いたアイデア・採点）を、DBに書く前からすぐ見せるためのメモと、いまの作業の進み具合
export type LiveNote = { key: string; at: string; who: string; provider: string | null; kind: string; text: string; batch: string };
export type Activity = { key: string; title: string; since: number; steps: Record<string, string> };
const gLive = globalThis as unknown as { __aiLabNotes?: LiveNote[]; __aiLabActivities?: Map<string, Activity> };
const liveNotes = (gLive.__aiLabNotes ??= []);
const activities = (gLive.__aiLabActivities ??= new Map());
const utcNow = () => new Date().toISOString().slice(0, 19).replace("T", " ");

function liveNote(n: Omit<LiveNote, "key" | "at">) {
  liveNotes.unshift({ ...n, key: `n${Date.now()}${Math.random().toString(36).slice(2, 6)}`, at: utcNow() });
  liveNotes.splice(60);
}
export function liveNotesList(): LiveNote[] {
  return [...liveNotes];
}
export function activityList(): Activity[] {
  return [...activities.values()];
}
function setStep(key: string, title: string, step: string, status: string) {
  const a = activities.get(key) ?? { key, title, since: Date.now(), steps: {} };
  a.title = title;
  a.steps[step] = status;
  activities.set(key, a);
}

// ほかのファイル（臨時会議など）から、ライブ画面に途中経過を出すとき用
export const liveStep = setStep;
export const liveSay = liveNote;
export function liveEnd(key: string) {
  activities.delete(key);
}

export function buildingList(): { id: number; what: string; since: number }[] {
  return [...building.entries()].map(([id, b]) => ({ id, ...b }));
}

export function buildingNow(id: number): { what: string; since: number } | null {
  return building.get(id) ?? null;
}

async function whileBuilding<T>(id: number, what: string, fn: () => Promise<T>): Promise<T> {
  // 同じ案件を2つ同時に作ると、版が重なって公開中の中身とずれるので止める
  const now = building.get(id);
  if (now) throw new Error(`AIがいま${now.what}。終わるまでお待ちください`);
  building.set(id, { what, since: Date.now() });
  try {
    return await fn();
  } finally {
    building.delete(id);
  }
}

export function getProject(id: number): ProjectRow | undefined {
  return db().prepare("SELECT * FROM projects WHERE id = ?").get(id) as ProjectRow | undefined;
}

export function lpVersions(projectId: number): LpVersionRow[] {
  return db().prepare("SELECT * FROM lp_versions WHERE project_id = ? ORDER BY version DESC").all(projectId) as LpVersionRow[];
}

// デモ案件の教訓は架空なので、AIへの入力には使わない（画面表示では区別して出す）
// シミュレーションの数字が混ざった案件の教訓も、同じく架空の結果なので使わない
export function activeLessons({ includeDemo = false } = {}): (LessonRow & { demo: number })[] {
  return db()
    .prepare(
      `SELECT l.*, CASE WHEN COALESCE(p.demo, 0) = 1 OR EXISTS (SELECT 1 FROM metrics m WHERE m.project_id = l.project_id AND m.source = 'simulated') THEN 1 ELSE 0 END AS demo
       FROM lessons l LEFT JOIN projects p ON p.id = l.project_id
       WHERE l.active = 1 ${includeDemo ? "" : "AND COALESCE(p.demo, 0) = 0 AND NOT EXISTS (SELECT 1 FROM metrics m WHERE m.project_id = l.project_id AND m.source = 'simulated')"} ORDER BY l.id DESC LIMIT 20`,
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
// alsoExisting: 既にある案件として扱う題名（仮テストで、前の日に選ばれたもの）
export async function askIdeas(theme: string, count: number, modelId?: string, alsoExisting: string[] = []): Promise<Idea[]> {
  const s = getSettings();
  const lessons = activeLessons().map(lessonLine).join("\n") || "（まだなし）";
  const existing = [...alsoExisting, ...(db().prepare("SELECT title FROM projects WHERE demo = 0 ORDER BY id DESC LIMIT 30").all() as { title: string }[]).map((p) => p.title)]
    .map((t) => `- ${t}`).join("\n") || "（まだなし）";
  // 選ばれなかった最近の案も渡す（同じ題材が毎日出ては負ける、の繰り返しを防ぐ）
  const recent = [...new Set((db().prepare("SELECT title FROM idea_candidates WHERE at >= datetime('now', '-7 days') ORDER BY id DESC LIMIT 60").all() as { title: string }[]).map((r) => r.title))]
    .map((t) => `- ${t}`).join("\n") || "（まだなし）";
  const out = await callJson<{ ideas: Idea[] }>({
    purpose: "アイデア出し",
    modelId,
    system: `あなたは個人や小さなチームが出すプロダクトのアイデアを考えるプロダクトマネージャーです。
プロダクトの種類は問わない（Webサービス・スマホアプリ・ブラウザ拡張・LINEボットやSlackアプリ・AIを使うサービス・テンプレートや素材などのデジタル商品など）。Webサービスばかりに偏らないこと。
アイデアごとに、世に出す形（kind）も選びます。形は1つにとらわれず、アイデアに合うものを選ぶこと。
- lp: 事前登録LP。まだ作らずに、紹介ページのメール事前登録で需要を確かめる。プロダクトの種類も、作る大変さも問わない（需要が確かめられてから作る）。継続して使うもの・作るのに時間がかかるもの向け
- tool: 動くツール。診断・シミュレーター・計算機・ジェネレーターなど、1つのWebページの中だけで完結して今すぐ使えるもの。外部のAPIやサーバー、ログインは使えない。何度も使いたくなるもの・結果を人に見せたくなるものが向く
条件:
- 医療・法律・金融など、規制が強い領域や専門資格が必要な領域は避ける（tool でも、診断の形で助言をしない）
- 誇大な約束はしない
- 実在の人物・団体のデータを使う tool は、正確なデータをコードに書けるものだけにする
- 季節や世の中の話題に頼りすぎない。件数のうち半分以上（1件だけなら、その1件）は、季節や話題が過ぎても1年中ある困りごと（evergreen）にする。季節もの（seasonal）を出すなら、その季節が終わっても使われる理由があるものを選ぶ
- 時期のネタや世の中の話題は、使ってもよいヒントにすぎない（必ず使う材料ではない）。事件・事故・災害・訃報・個人の不祥事など、人の不幸や特定の個人に乗った企画はしない
- 最初の利用者にどう届くかも、一緒に考える。広告は使わず、フォロワーがほぼいないSNSアカウント（X・Threads・Bluesky への自動投稿ができる）と、運営者の手作業でできる範囲で。「SNSで宣伝する」のような曖昧な書き方ではなく、その対象者がすでに集まっている具体的な場所（検索される言葉・ハッシュタグ・コミュニティ・時期の話題など）と、そこでの見せ方を書く。他人の投稿やQ&Aサイトの質問に、宣伝のための返信・回答をする案や、知らない人へのDM・個別の勧誘は出さない（スパム扱いされやすいため）
- 自分の投稿だけ（フォロワーほぼ0では、ほとんど表示されない）にせず、運営者が手でできる直接の接点を最低1つ、数つきで入れる。例: 対象の人が集まるコミュニティ・グループの管理者に、紹介してよいか相談する（2か所）/ 対象に当てはまる知人に使ってもらい、感想を聞く（3人）/ ルールで紹介が認められている場（自己紹介・成果物の共有の場など）に1回だけ載せる
過去の教訓がある場合は必ず踏まえ、既にある案件と重複しないこと。教訓の確かさが「低」のものは仮説として扱い、それだけで題材や対象者を避けない。「最近出た案」と同じ題材・同じ困りごとの言い換えも出さない（別の対象者・別の困りごとを探す）。
形式: {"ideas":[{"kind":"lp または tool","title":"サービス名","target":"誰向けか（具体的に）","problem":"その人が困っていること・欲しいこと","solution":"どう解決するか（どんな種類のプロダクトか（Webサービス・スマホアプリなど）も書く。tool なら何ができるツールか）","hypothesis":"検証したい仮説（数字で判定できる形）","channel":"最初の利用者がいる具体的な場所と、そこでの届け方","first_test":"公開から最初の1週間で、何人に届けて、何が起きれば手応えありとするか","season":"seasonal（その時期だけの需要）または evergreen（1年中ある需要）","reason":"このアイデアとこの形を選んだ理由","confidence":0から1の数値（反応がある見込み）,"want_id":元にした「欲しい」の声の番号（声から作ったときだけ。数値）}]}`,
    // 仮説の基準と、判断で使う目標がずれないように揃える
    user: `テーマ: ${theme || "おまかせ"}\n件数: ${count}\n仮説の判定基準（形ごと。この基準を使うこと）:\n- lp: 訪問者の事前登録率 ${(s.targetSignupRate * 100).toFixed(1)}% 以上、訪問 ${s.judgeMinVisits}人で判定\n- tool: 訪問者のうち実際に使った人の割合 ${(s.targetUseRate * 100).toFixed(0)}% 以上、訪問 ${s.judgeMinVisits}人で判定（シェア数も参考にする）\n\n参考のヒント（使わなくてよい。季節もの以外のアイデアも半分以上出すこと）\n時期のネタ:\n${seasonalContext(new Date(), s.trendNotes)}\n\n${trendsText() || "（いまの話題はまだ取得していません）"}\n\n過去の教訓:\n${lessons}\n\n既にある案件:\n${existing}\n\n最近出た案（選ばれなかったものも含む。同じ題材は出さない）:\n${recent}${viralHints("idea")}${wantsText()}${planIdeaNote()}\n\n${outsideText()}（アイデア出しでは、実際の人が何に困ったか・何に反応したかを、題材や届け方の参考にする）`,
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
        `INSERT INTO projects (title, target, problem, solution, hypothesis, ai_reason, ai_confidence, stage, model_id, theme, mode, origin, idea_model, mode_confidence, kind, first_channel, first_test, want_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'idea', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(idea.title, idea.target, idea.problem, idea.solution, idea.hypothesis, idea.reason, conf, getSettings().loopModel, theme || null, mode, origin, ideaModel, choice.confidence, idea.kind === "tool" ? "tool" : "lp",
        isStr(idea.channel) ? idea.channel.slice(0, 500) : null, isStr(idea.first_test) ? idea.first_test.slice(0, 500) : null,
        typeof idea.want_id === "number" && getWant(idea.want_id)?.status === "ok" ? idea.want_id : null)
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
  logEvent(id, "system", "auto", `自動モードのため、アイデアの承認を省いて${p.kind === "tool" ? "ツール" : "LP"}を作成`);
  await prepareLp(id, undefined, { auto: true });
}

// 手動でアイデアを依頼したとき: 毎日の分と同じく、3社が案を出し、作者を伏せて採点し、上位の件数だけ案件にする
export async function generateIdeas(theme: string, count = 3): Promise<number[]> {
  const title = theme ? `アイデア出し（テーマ: ${theme.slice(0, 30)}）` : "アイデア出し（おまかせ）";
  const { candidates, kept } = await withIdeaLock(title, () => gatherAndScoreIdeas(Math.max(2, count), count, false, { title, theme }));
  if (!candidates.length) throw new Error("どのAIからもアイデアを得られませんでした");
  const ids: number[] = [];
  for (const c of kept) {
    const conf = c.peerAvg !== null ? { value: c.peerAvg / 10, source: "他社のAIによる採点の平均" } : selfConfidence(c.idea);
    const id = insertProject(c.idea, theme, { ...nextMode(conf), confidence: conf.value }, "manual", c.author);
    db().prepare("UPDATE idea_candidates SET selected = 1, project_id = ? WHERE id = ?").run(id, c.id);
    logEvent(id, "ai", "select", `${candidates.length}件の候補から選ばれました（3社のAIによる採点の平均 ${c.avg.toFixed(1)}点 / 10点）`);
    ids.push(id);
  }
  for (const c of candidates.filter((x) => !kept.includes(x))) {
    logEvent(null, "ai", "idea-skipped", `アイデア「${c.idea.title}」を見送り（${modelLabel(c.author)}の案・平均 ${c.avg.toFixed(1)}点）`);
  }
  // LP・ツールの作成は数分かかるので、画面を待たせずに裏で順に進める
  void (async () => {
    for (const id of ids) {
      await startProject(id).catch((e) => logEvent(id, "system", "lp-error", `作成に失敗: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`));
    }
  })();
  return ids;
}

// ---- 2. LP作成とAIチェック ----

// LPの候補を3社で作るとき、見た目が似通わないように1社ずつ違う方向性を渡す
const DESIGN_DIRECTIONS = [
  "信頼感と落ち着き（説明は丁寧に、余白を多めに）",
  "親しみやすくやわらかい（会話のような言葉、丸みのある見た目）",
  "シンプルで力強い（短い言葉、大きな見出し、メリハリ）",
  "あたたかく生活感がある（使う場面が目に浮かぶ言葉）",
  "遊び心がある（意外性のある見出し、明るい見た目）",
  "上品で大人っぽい（言葉を選び、装飾は控えめに）",
];

async function writeLp(p: ProjectRow, instruction?: string, keepCore = false, modelId?: string, purpose = "LP作成", direction?: string): Promise<Lp & { shareText?: string }> {
  const isTool = p.kind === "tool";
  const before = p.lp ? (JSON.parse(p.lp) as Lp) : null;
  // 自由に書いたページのHTMLは長いので、文言の材料としては渡さない
  const prev = before ? `\n\n今のLP:\n${JSON.stringify({ ...before, page: undefined })}` : "";
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
見た目も対象読者に合わせて選ぶ（決まった部品の組み合わせで表示される。いつも同じ組み合わせにせず、このサービスらしさが出るものを選ぶ）:${direction ? `\n- 今回のデザインの方向性: ${direction}（これに合う組み合わせ・言葉づかいにする）` : ""}
- design.theme（テーマ色）: ${Object.entries(THEMES).map(([k, t]) => `${k}=${t.label}`).join(" / ")}
${(Object.keys(DESIGN_OPTIONS) as (keyof typeof DESIGN_OPTIONS)[]).map((k) => `- design.${k}: ${Object.entries(DESIGN_OPTIONS[k]).map(([v, l]) => `${v}=${l}`).join(" / ")}`).join("\n")}
- design.order: ${SECTIONS.join(" / ")} を、読んでほしい順に並べたもの（pains=困りごと, beforeAfter=使う前後, features=できること, steps=使い方, faq=よくある質問）
- design.badge: 見出しの上に出す短いラベル（15文字以内。例「飲食店のシフト集めに」）
- illustrationPrompt: 見出しの横に置くイラストを描くAIへの指示（英語で2〜3文）。サービスを使っている場面や、困りごとが解決した場面を、人物の顔をはっきり描かない形で。文字・ロゴ・実在の人物や商品は描かせない
- preview: 完成したら使う画面のイメージ。kind は ${PREVIEW_KINDS.join(" / ")} のどれか。rows は1行あたり最大4つの短い文字列で3〜5行（list は [項目, 状態]、table は columns と各行、chat は [話し手, 発言]、form は [項目名, 入力例]）。人名は「山田さん」程度の仮名にし、実在の会社名や効果の数字は入れない
- features[].icon: ${ICONS.join(" / ")} から内容に合うもの
- steps: 使い方を3ステップ（任意）
- beforeAfter: 使う前の状態と、使ったあとに目指す状態を各2〜3個（任意。効果を断言しない）${isTool ? "\n- shareText: X でシェアするときの文（60文字以内。ハッシュタグは1つまで。誇張しない）" : ""}
形式: {"headline":"見出し","subheadline":"補足の一文","pains":["悩み","悩み","悩み"],"features":[{"title":"特徴","body":"説明","icon":"clock"}×3],"cta":"ボタンの文言","faq":[{"q":"質問","a":"回答"}×2],"design":{"theme":"trust","layout":"split","font":"gothic","pattern":"none","corners":"round","painStyle":"cards","featureStyle":"cards","order":["pains","features","steps","faq"],"badge":"ラベル"},"illustrationPrompt":"A calm scene of ...","preview":{"title":"画面の名前","kind":"list","columns":[],"rows":[["項目","状態"]]},"steps":[{"title":"手順","body":"説明"}×3],"beforeAfter":{"before":["今の状態"],"after":["目指す状態"]}${isTool ? ',"shareText":"シェアの文"' : ""}}`,
    user: `サービス名: ${p.title}\n対象: ${p.target}\n課題: ${p.problem}\n解決策: ${p.solution}\n仮説: ${p.hypothesis}${prev}${instruction ? `\n\n今回の修正指示: ${instruction}` : ""}`,
    validate: isLp,
  });
  // 知らない値や長すぎる文は落としてから保存する
  const shareText = (lp as { shareText?: unknown }).shareText;
  const out = normalizeLp(lp);
  // イラストはシステムが作って付けるもの。AIの出力にURLがあっても使わず、前の版のイラストを引き継ぐ
  if (out.design) out.design.illustration = before?.design?.illustration;
  return { ...out, shareText: typeof shareText === "string" ? shareText.slice(0, 100) : undefined };
}

// 公開前に、別の観点のAIが問題がないかを確認する
async function reviewLp(p: ProjectRow, lp: Lp, before?: Lp): Promise<Review> {
  const out = await callJson<Review>({
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
形式: {"ok":true または false,"issues":["問題点"]}
${EXTRAS_RULE}`,
    user: `対象読者: ${p.target}\nサービスの中身: ${p.solution}\n\nチェックするLP:\n${JSON.stringify(lp)}${before ? `\n\n前の版:\n${JSON.stringify(before)}` : ""}`,
    validate: isReview,
  });
  takeExtras(out, { modelId: getSettings().loopModel, scene: "LPのチェック", projectId: p.id });
  return { ok: out.ok, issues: out.issues };
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

export async function writeToolHtml(p: ProjectRow, instruction?: string, prevHtml?: string, modelId?: string): Promise<string> {
  const system = `あなたは小さなWebツールを作るフロントエンドエンジニアです。紹介ページの中の枠に埋め込まれる、ツール本体を1つ書きます。
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
`;
  const user = `ツール名: ${p.title}\n対象: ${p.target}\n使う人の動機・困りごと: ${p.problem}\n何ができるツールか: ${p.solution}${prevHtml ? `\n\n今のツール:\n${prevHtml}` : viralHints("tool")}${instruction ? `\n\n今回の修正指示: ${instruction}` : ""}`;
  // ツールのHTMLは長く、JSONに包むと出力の上限で途中で切れやすい。HTMLをそのまま最後まで受け取る
  const author = modelId ?? claudeModelId();
  if (author) {
    const text = await callLong({
      modelId: author,
      purpose: "ツール作成",
      projectId: p.id,
      system: `${system}出力はHTMLの断片だけ。説明やコードブロックは付けない。`,
      user,
      maxTokens: 64000,
    });
    return text.replace(/^\s*```(?:html)?\s*/i, "").replace(/```\s*$/, "").trim();
  }
  const out = await callJson<{ html: string }>({
    purpose: "ツール作成",
    projectId: p.id,
    system: `${system}形式: {"html":"ツール本体のHTML"}`,
    user,
    validate: (v): v is { html: string } => isObj(v) && isStr(v.html),
  });
  return out.html.trim();
}

// ツール本体をAIが読んで、動かない箇所や問題のある内容がないかを確かめる
async function reviewTool(p: ProjectRow, html: string): Promise<Review> {
  const out = await callJson<Review>({
    purpose: "ツールチェック",
    projectId: p.id,
    system: `あなたはWebツールの公開前チェック担当です。コードを読んで、次の点に1つでも当てはまれば ok を false にし、issues に具体的に書きます。
- 文法の誤りや、ボタンを押しても何も起きない・結果が出ないなど、動かない箇所がある
- 外部への通信、外部ファイルの読み込み、保存領域・Cookie・alert・window.open を使っている
- 個人を特定できる情報を入力させている
- 架空の統計を事実のように書いている、医療・法律・お金の助言をしている、誰かを傷つける・差別的な内容がある
- 実在の人物・団体について、不正確そうなデータを使っている
- 「${p.solution}」というツールの目的からずれている
- 使う前と後・改善前と後などの比較を出すとき、利用者が条件を変えても、比較の基準（前の値）が同じ条件で計算されていない（条件によって改善率がマイナスになる・表示が崩れる など）
問題がなければ {"ok":true,"issues":[]}。
形式: {"ok":true または false,"issues":["問題点"]}
${EXTRAS_RULE}`,
    user: html,
    validate: isReview,
  });
  takeExtras(out, { modelId: getSettings().loopModel, scene: "ツールのチェック", projectId: p.id });
  return { ok: out.ok, issues: out.issues };
}

// ツール本体を書いてチェックし、問題があれば1回だけ直す
// チェックは3つ: コードの決まりごと、AIによるコードの確認、本物のブラウザ（スマホ幅）で動かすテスト
// ツールのコードを書くAI。新しいツールは、使える候補のうち作った数が一番少ないものに順番に任せる（作り比べのため）
// 直すときは、今のツールを書いたAIがそのまま直す
export const TOOL_MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "gpt-5.6-sol"];

function toolModelFor(p: ProjectRow): string {
  const usable = TOOL_MODELS.filter((id) => hasKey(modelInfo(id).provider));
  const current = (db().prepare("SELECT tool_model FROM lp_versions WHERE project_id = ? AND tool_model IS NOT NULL ORDER BY version DESC LIMIT 1").get(p.id) as { tool_model: string } | undefined)?.tool_model;
  if (current && usable.includes(current)) return current;
  if (!usable.length) return getSettings().loopModel;
  const counts = new Map((db().prepare("SELECT tool_model AS m, COUNT(DISTINCT project_id) AS n FROM lp_versions WHERE tool_model IS NOT NULL GROUP BY tool_model").all() as { m: string; n: number }[]).map((r) => [r.m, r.n]));
  return [...usable].sort((a, b) => (counts.get(a) ?? 0) - (counts.get(b) ?? 0) || Math.random() - 0.5)[0];
}

async function buildTool(p: ProjectRow, shotName: string, instruction?: string, prevHtml?: string): Promise<{ html: string; review: Review; test: ToolTest; model: string; rewrites: number }> {
  const model = toolModelFor(p);
  let html = await writeToolHtml(p, instruction, prevHtml, model);
  const check = async (h: string): Promise<{ review: Review; test: ToolTest }> => {
    const [ai, test] = await Promise.all([reviewTool(p, h), testTool(h, shotName)]);
    const issues = [...staticToolIssues(h), ...ai.issues, ...testIssues(test)];
    return { review: { ok: issues.length === 0 && ai.ok, issues }, test };
  };
  let r = await check(html);
  if (!r.review.ok) {
    logEvent(p.id, "ai", "review", `ツールのチェックで問題が見つかったため書き直し: ${r.review.issues.join(" / ")}`);
    html = await writeToolHtml(p, `次の問題を直すこと: ${r.review.issues.join(" / ")}`, html, model);
    r = await check(html);
    return { html, ...r, model, rewrites: 1 };
  }
  return { html, ...r, model, rewrites: 0 };
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
  const directions = [...DESIGN_DIRECTIONS].sort(() => Math.random() - 0.5);
  const written = await Promise.all(
    authors.map(async (author, i) => {
      try {
        const { shareText: _drop, ...lp } = await writeLp(p, undefined, false, author, "LPの候補作成", directions[i % directions.length]);
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
    conn.prepare("UPDATE lp_versions SET lp = ?, review = ?, author_model = ?, test = NULL, note = COALESCE(note, '') || ? WHERE project_id = ? AND version = ?")
      .run(JSON.stringify(lp), JSON.stringify(review), c.author_model, `（あなたが候補${c.label}に切り替え）`, p.id, c.version);
    conn.prepare("UPDATE lp_candidates SET human_selected = (id = ?) WHERE project_id = ? AND version = ?").run(c.id, p.id, c.version);
    conn.prepare("UPDATE approvals SET payload = ? WHERE id = ?").run(JSON.stringify({ review }), pending.id);
  })();
  const hadPage = !!(JSON.parse(p.lp ?? "{}") as Lp).page;
  logEvent(p.id, "human", "lp-switch", `LPを候補${c.label}に切り替えました${review.ok ? "" : `（チェックで問題: ${review.issues.join(" / ")}）`}${hadPage ? "。自由なデザインのページは外れたので、必要なら「デザインし直す」で作り直してください" : ""}`);
}

// LPを書き、チェックし、問題があれば1回だけ直す。新しい版として保存する
// 動くツールの案件では、ツール本体も作る（改善のときは、指示がツールとページのどちらに向くかをAIの指示文に任せる）
async function buildLpVersion(projectId: number, opts: { instruction?: string; note: string; keepCore?: boolean }) {
  const kind = getProject(projectId)!.kind;
  const what = `${kind === "tool" ? "ツール" : "LP"}を${opts.instruction || opts.keepCore ? "直して" : "作って"}います`;
  return whileBuilding(projectId, what, () => buildLpVersionNow(projectId, opts));
}

async function buildLpVersionNow(projectId: number, opts: { instruction?: string; note: string; keepCore?: boolean }) {
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
    // 最初の版を1社で作るときも、方向性をランダムに渡して見た目が似通わないようにする
    const direction = before ? undefined : DESIGN_DIRECTIONS[Math.floor(Math.random() * DESIGN_DIRECTIONS.length)];
    lp = await writeLp(p, opts.instruction, opts.keepCore, undefined, "LP作成", direction);
  }
  let review = await reviewLp(p, lp, opts.keepCore ? before : undefined);
  if (!review.ok) {
    logEvent(projectId, "ai", "review", `チェックで問題が見つかったため書き直し: ${review.issues.join(" / ")}`);
    lp = await writeLp({ ...p, lp: JSON.stringify(lp) }, `次の問題を直すこと: ${review.issues.join(" / ")}`, opts.keepCore, author);
    review = await reviewLp(p, lp, opts.keepCore ? before : undefined);
  }
  const version = nextVersion(p.id);
  // 見出しの横のイラスト（まだ無いときだけ描く。改善の版では前のイラストを引き継ぐ）
  const drawn = await withIllustration(p, lp, version);
  lp = drawn.lp;
  if (drawn.note) logEvent(projectId, "system", "illustration", drawn.note);
  // 部品で作ったLPを材料に、AIがページ全体を自由にデザインする（うまくいかなければ部品のLPのまま）
  let pageCheck: PageCheck | null = null;
  if (getSettings().freePage) {
    const made = await withPage(p, lp, version, { prevHtml: before?.page?.html, instruction: opts.instruction, keepCore: opts.keepCore });
    lp = made.lp;
    pageCheck = made.check;
    if (pageCheck && !pageCheck.ok) review = { ok: false, issues: [...review.issues, ...pageCheck.issues.map((x) => `デザイン: ${x}`)] };
  }
  const conn = db();
  conn.prepare("UPDATE projects SET lp = ?, lp_version = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(lp), version, projectId);
  conn.prepare("INSERT INTO lp_versions (project_id, version, lp, note, review, author_model, test) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(projectId, version, JSON.stringify(lp), note, JSON.stringify(review), author, pageCheck ? JSON.stringify(pageCheck) : null);
  logEvent(projectId, "ai", "lp", `LPを作成（第${version}版${compete ? "・3社の候補から選択" : ""}${lp.page ? "・自由なデザイン" : ""}）: ${lp.headline}${review.ok ? "" : "（チェックで問題が残っています）"}`);
  return { lp, review, version };
}

// ページのデザインで Claude と作り比べる、別の会社のAI。使える候補のうち、比べた回数が少ない方に順番に任せる
export const PAGE_RIVALS = ["gpt-5.6-sol", "gemini-3.1-pro-preview"];

function pageRivalFor(): string | null {
  const usable = PAGE_RIVALS.filter((id) => hasKey(modelInfo(id).provider));
  if (!usable.length) return null;
  const counts = new Map((db().prepare("SELECT model AS m, COUNT(*) AS n FROM page_candidates WHERE model IS NOT NULL GROUP BY model").all() as { m: string; n: number }[]).map((r) => [r.m, r.n]));
  return [...usable].sort((a, b) => (counts.get(a) ?? 0) - (counts.get(b) ?? 0) || Math.random() - 0.5)[0];
}

// AIにページ全体を自由にデザインさせる。失敗したら、部品で作ったLPのまま返す
async function withPage(p: ProjectRow, lp: Lp, version: number, opts: { prevHtml?: string; instruction?: string; keepCore?: boolean } = {}): Promise<{ lp: Lp; check: PageCheck | null }> {
  const done = (html: string, check: PageCheck, note: string) => {
    logEvent(p.id, "ai", "page", `ページ全体をデザイン（${(html.length / 1000).toFixed(1)}千文字）${note}${check.ok ? "" : `。確認で残った指摘: ${check.issues.join(" / ")}`}`);
    return { lp: { ...lp, ...pageTexts(html), page: { html } }, check };
  };
  try {
    // 新しく作るときは、Claude と別の会社のAIで2案を作り、画面を見たAIの採点で選ぶ（直すときは今のページを直す1案だけ）
    const main = claudeModelId();
    const rival = opts.prevHtml || opts.instruction || !main ? null : pageRivalFor();
    if (!rival) {
      const made = await buildPage(p, lp, `p${p.id}-v${version}-page`, opts);
      return done(made.html, made.check, "");
    }
    const label = (id: string) => modelInfo(id).label;
    const [a, b] = await Promise.allSettled([
      buildPage(p, lp, `p${p.id}-v${version}-pageA`, { ...opts, modelId: main! }),
      buildPage(p, lp, `p${p.id}-v${version}-pageB`, { ...opts, modelId: rival }),
    ]);
    const save = db().prepare("INSERT INTO page_candidates (project_id, version, with_refs, model, score, reason, selected, check_json, html, judges) VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?, ?)");
    if (a.status === "fulfilled" && b.status === "fulfilled") {
      const j = await judgePages(p, a.value.check, b.value.check, { a: label(main!), b: label(rival) });
      const pick = j.winner === "b" ? b.value : a.value;
      const won = j.winner === "b" ? rival : main!;
      save.run(p.id, version, main, j.scoreA, j.reason, j.winner === "a" ? 1 : 0, JSON.stringify(a.value.check), a.value.html, JSON.stringify(j.judges));
      save.run(p.id, version, rival, j.scoreB, j.reason, j.winner === "b" ? 1 : 0, JSON.stringify(b.value.check), b.value.html, JSON.stringify(j.judges));
      logEvent(p.id, "ai", "page-select", `デザインを${label(main!)}と${label(rival)}で2案作り、${j.judges.length}社のAIが画面で見比べて「${label(won)}」の案を選びました（平均 ${label(main!)} ${j.scoreA}点・${label(rival)} ${j.scoreB}点。${j.judges.map((x) => `${label(x.modelId)}の採点 ${x.a}対${x.b}`).join("・")}）`);
      return done(pick.html, pick.check, `・${label(won)}の案`);
    }
    if (a.status === "rejected" && b.status === "rejected") throw a.reason;
    const [one, by, failed] = a.status === "fulfilled" ? [a.value, main!, b] : [(b as PromiseFulfilledResult<{ html: string; check: PageCheck }>).value, rival, a];
    const why = failed.status === "rejected" ? (failed.reason instanceof Error ? failed.reason.message : String(failed.reason)).slice(0, 120) : "";
    return done(one.html, one.check, `・${label(by)}の案（もう一方は作れなかった: ${why}）`);
  } catch (e) {
    logEvent(p.id, "system", "page-error", `自由なデザインのページを作れなかったため、部品で作ったLPを使います: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`);
    return { lp: { ...lp, page: undefined }, check: null };
  }
}

// 今の版のページ全体を、AIにデザインし直させる（候補を切り替えたあとなど。案件の画面のボタンから）。公開中の版なら公開サイトにも反映する
export async function redesignPage(projectId: number) {
  const p = getProject(projectId);
  if (!p?.lp || p.kind !== "lp") throw new Error("事前登録LPの案件だけデザインし直せます");
  const current = JSON.parse(p.lp) as Lp;
  const made = await whileBuilding(projectId, "ページをデザインしています", () => withPage(p, { ...current, page: undefined }, p.lp_version));
  if (!made.lp.page) throw new Error("デザインを作れませんでした（経過を確認してください）");
  db().prepare("UPDATE projects SET lp = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(made.lp), projectId);
  db().prepare("UPDATE lp_versions SET lp = ?, test = ? WHERE project_id = ? AND version = ?").run(JSON.stringify(made.lp), JSON.stringify(made.check), projectId, p.lp_version);
  logEvent(projectId, "human", "page", "ページ全体をデザインし直しました");
  const now = getProject(projectId)!;
  if (now.public_slug && now.public_version === now.lp_version && now.stage !== "killed") await announcePublish(projectId);
}

export type PageCandidateRow = {
  id: number; at: string; project_id: number; version: number; with_refs: number; ref_ids: string | null; model: string | null;
  score: number | null; reason: string | null; selected: number; check_json: string | null; html: string | null; judges: string | null;
};

// 案の呼び名。以前の案は、参考のあり・なしで呼ぶ
export function pageCandidateLabel(c: Pick<PageCandidateRow, "model" | "with_refs">): string {
  return c.model ? modelInfo(c.model).label : c.with_refs ? "参考あり" : "参考なし";
}

// 今の版で最後に作った2案（作った順。Claude の案が先）。selected は「AIが選んだ方」のまま残し、人が入れ替えても変えない（成績の集計に使うため）
export function pageCandidates(projectId: number, version: number): PageCandidateRow[] {
  return (db().prepare("SELECT * FROM page_candidates WHERE project_id = ? AND version = ? ORDER BY id DESC LIMIT 2").all(projectId, version) as PageCandidateRow[])
    .sort((a, b) => a.id - b.id);
}

// 2案のうち、もう一方のページに入れ替える（人が押したとき）。公開中の版なら公開サイトにも反映する
export async function switchPageCandidate(projectId: number, candidateId: number) {
  const p = getProject(projectId);
  if (!p?.lp || p.kind !== "lp") throw new Error("事前登録LPの案件だけ入れ替えられます");
  const c = pageCandidates(projectId, p.lp_version).find((x) => x.id === candidateId);
  if (!c?.html) throw new Error("この案はページが残っていないため、入れ替えられません");
  const lp: Lp = { ...(JSON.parse(p.lp) as Lp), ...pageTexts(c.html), page: { html: c.html } };
  db().prepare("UPDATE projects SET lp = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(lp), projectId);
  db().prepare("UPDATE lp_versions SET lp = ?, test = ? WHERE project_id = ? AND version = ?").run(JSON.stringify(lp), c.check_json, projectId, p.lp_version);
  logEvent(projectId, "human", "page", `デザインを「${pageCandidateLabel(c)}」の案に入れ替えました`);
  const now = getProject(projectId)!;
  if (now.public_slug && now.public_version === now.lp_version && now.stage !== "killed") await announcePublish(projectId);
}

// 自由なデザインをやめて、部品で作ったLPに戻す
export async function removePage(projectId: number) {
  const p = getProject(projectId);
  if (!p?.lp) throw new Error("まだLPがありません");
  const lp = { ...(JSON.parse(p.lp) as Lp), page: undefined };
  db().prepare("UPDATE projects SET lp = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(lp), projectId);
  db().prepare("UPDATE lp_versions SET lp = ?, test = NULL WHERE project_id = ? AND version = ?").run(JSON.stringify(lp), projectId, p.lp_version);
  logEvent(projectId, "human", "page", "自由なデザインをやめて、部品で作ったLPに戻しました");
  const now = getProject(projectId)!;
  if (now.public_slug && now.public_version === now.lp_version && now.stage !== "killed") await announcePublish(projectId);
}

async function buildToolVersion(p: ProjectRow, before: Lp | undefined, opts: { instruction?: string; note: string; keepCore?: boolean }) {
  const { shareText, ...page } = await writeLp(p, opts.instruction, opts.keepCore);
  const version = nextVersion(p.id);
  const tool = await buildTool(p, `p${p.id}-v${version}`, opts.instruction, before?.tool?.html);
  const pageReview = await reviewLp(p, page, opts.keepCore ? before : undefined);
  const review: Review = { ok: tool.review.ok && pageReview.ok, issues: [...tool.review.issues, ...pageReview.issues] };
  let lp: Lp = normalizeLp({ ...page, preview: undefined, tool: { html: tool.html, shareText: shareText ?? page.headline } });
  if (!lp.tool) throw new Error("ツールが大きすぎるか空のため保存できませんでした");
  if (lp.design) lp.design.illustration = before?.design?.illustration;
  const drawn = await withIllustration(p, lp, version);
  lp = drawn.lp;
  if (drawn.note) logEvent(p.id, "system", "illustration", drawn.note);
  const conn = db();
  conn.prepare("UPDATE projects SET lp = ?, lp_version = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(lp), version, p.id);
  conn.prepare("INSERT INTO lp_versions (project_id, version, lp, note, review, author_model, test, tool_model, tool_rewrites) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(p.id, version, JSON.stringify(lp), opts.note, JSON.stringify(review), getSettings().loopModel, JSON.stringify(tool.test), tool.model, tool.rewrites);
  logEvent(p.id, "ai", "lp", `ツールと紹介ページを作成（第${version}版・${(tool.html.length / 1000).toFixed(1)}千文字・コードは${modelLabel(tool.model)}${tool.rewrites ? "・1回直した" : ""}）: ${lp.headline}${review.ok ? "" : "（チェックで問題が残っています）"}`);
  return { lp, review, version };
}

// 全自動で公開してよいか。だめなら理由を返す
function autoPublishBlocked(p: ProjectRow, review: Review): string | null {
  const s = getSettings();
  if (!s.fullAuto || p.mode !== "auto") return "全自動ではない";
  if (!review.ok) return `AIのチェックで問題が残ったため（${review.issues.join(" / ").slice(0, 200)}）`;
  const n = (db().prepare("SELECT COUNT(*) AS n FROM events WHERE kind = 'auto-publish' AND at >= datetime('now', '-7 days')").get() as { n: number }).n;
  if (n >= s.autoPublishPerWeek) return `直近7日に人の承認なしで公開した件数が上限（${s.autoPublishPerWeek}件）に達したため`;
  return null;
}

// 新しいLPを作って、公開の承認待ちにする（最初の公開は、どちらのモードでも人が承認する）
// 版の番号は、公開しなかった版も含めて通し番号にする（却下して前の版に戻したあとも重ならないように）
function nextVersion(projectId: number): number {
  const r = db().prepare("SELECT MAX(version) AS v FROM lp_versions WHERE project_id = ?").get(projectId) as { v: number | null };
  return (r.v ?? 0) + 1;
}

export async function prepareLp(projectId: number, instruction?: string, opts: { keepCore?: boolean; byHuman?: boolean; auto?: boolean } = {}) {
  const p = getProject(projectId)!;
  const note = !instruction ? "最初の版" : opts.byHuman ? `あなたの指示: ${instruction}` : `指示: ${instruction}`;
  const { lp, review } = await buildLpVersion(projectId, { instruction, note, keepCore: opts.keepCore });
  setStage(projectId, "lp");
  // 全自動: チェックを通ったものだけ、人の承認なしで公開する（あとから人が見て印を付ける）
  const blocked = opts.auto ? autoPublishBlocked(p, review) : "対象外";
  if (!blocked) {
    db().prepare("UPDATE projects SET auto_published = 1 WHERE id = ?").run(projectId);
    setStage(projectId, "live");
    logEvent(projectId, "system", "auto-publish", `全自動のため、人の承認なしで公開しました（AIのチェック: 問題なし）`);
    await announcePublish(projectId);
    return;
  }
  if (opts.auto && getSettings().fullAuto) logEvent(projectId, "system", "auto-blocked", `${blocked}、公開は人の承認に回します`);
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

// 判断のきっかけ: visits = 訪問が十分たまった / budget = 広告費の線を越えた / slow = 日数がたったのに訪問が少ない
export type JudgeTrigger = "visits" | "budget" | "slow";

const daysSinceUtc = (utc: string | null) => (utc ? (Date.now() - Date.parse(utc.replace(" ", "T") + "Z")) / 86_400_000 : 0);

export function judgePrompt(p: ProjectRow, trigger: JudgeTrigger = "visits") {
  const s = getSettings();
  const cur = projectTotals(p.id, p.lp_version);
  const all = projectTotals(p.id);
  const history = (db().prepare("SELECT message FROM events WHERE project_id = ? ORDER BY id").all(p.id) as { message: string }[])
    .map((e) => `- ${e.message}`).join("\n");
  const isTool = p.kind === "tool";
  const c = CONV[p.kind];
  const shares = all.rows.reduce((n, r) => n + (r.shares ?? 0), 0);
  const growing = !!p.growth_phase;
  const posts = (db().prepare("SELECT platform, COUNT(*) AS n, SUM(visits) AS v, SUM(conversions) AS cv FROM sns_posts WHERE project_id = ? AND status = 'posted' GROUP BY platform").all(p.id) as { platform: string; n: number; v: number; cv: number }[])
    .map((x) => `${x.platform} ${x.n}件（訪問${x.v}・成果${x.cv}）`).join(" / ") || "まだなし";
  const thing = isTool ? "ツールか紹介ページ" : "LP";
  // 集客を見直したあとの効果が分かるように、見直す前と後の数字を分ける（訪問は日ごとの記録なので、見直した日の分は「後」に入れる）
  const since = p.growth_focus_at;
  const split = (() => {
    if (!since) return "";
    const day = since.slice(0, 10);
    const sum = (rows: MetricRow[]) => rows.reduce((a, r) => ({ v: a.v + r.visits, c: a.c + r.signups }), { v: 0, c: 0 });
    const before = sum(all.rows.filter((r) => r.day < day));
    const after = sum(all.rows.filter((r) => r.day >= day));
    const rate = (x: { v: number; c: number }) => (x.v ? `${((x.c / x.v) * 100).toFixed(1)}%` : "—");
    const postsAfter = (db().prepare("SELECT COUNT(*) AS n, COALESCE(SUM(visits), 0) AS v, COALESCE(SUM(conversions), 0) AS cv FROM sns_posts WHERE project_id = ? AND status = 'posted' AND posted_at >= ?").get(p.id, since) as { n: number; v: number; cv: number });
    const days = Math.max(0, Math.floor(daysSinceUtc(since)));
    return `\n最後に集客を見直してから ${days}日（${day}〜）:\n- 見直す前: 訪問 ${before.v}人 / ${c.noun} ${before.c}人 / ${c.rate} ${rate(before)}\n- 見直した後: 訪問 ${after.v}人 / ${c.noun} ${after.c}人 / ${c.rate} ${rate(after)}\n- 見直した後のSNSへの投稿: ${postsAfter.n}件（訪問${postsAfter.v}・成果${postsAfter.cv}）\n見直しの効果は「見直した後」の数字で判断する。見直した後の訪問がまだ少なければ、効果は判断できない（collect も考える）。`;
  })();
  const options = growing
    ? `この案件はすでに「続ける」と判断され、育てる段階にある（需要は確認済み）。次の育てる実験を1つ選ぶ。
- improve: ${isTool ? "機能を1つ足す・何度も使いたくなる工夫・結果を共有したくなる工夫など、ツールか紹介ページを1か所変える" : "LPを1か所変えて、登録をさらに増やす"}
- rethink: ページは変えずに、集客の場所・切り口・対象を広げる（まだ試していない場所や、近い対象者へ）
- collect: 今の実験の結果がまだ出ていないので、変えずに様子を見る
- kill: 反応が落ちきって、これ以上育てる見込みがない（めったに選ばない）`
    : `次のどれかを選ぶ。
- continue: ${isTool ? "よく使われているので、機能を足す・広めるなど、育てる段階へ進む" : "需要が確認できたので、育てる段階へ進む（実際に作るかは運営者が決める）"}
- improve: 訪問者は来ているが、${c.noun}につながっていない。今すぐ${thing}を1か所変えてもう一度集客する
- rethink: そもそも人が来ていない・届いていない。ページは変えずに、投稿の切り口・集客する場所・対象者の言い方を変えて、もう一度集客する
- collect: 今のまま、もう少し集客してから判断する
- kill: 需要が見込めないので撤退する`;
  const slowNote = trigger === "slow"
    ? `\n今回は、公開（または前回の判断）から${s.judgeAfterDays}日たっても訪問が少ないので判断する。訪問が少ないことは「需要がない」とは限らず、「届いていない」だけかもしれない。投稿の数・反応も見て、まず届け方の問題（rethink）か、届いているのに反応がない（kill・improve）かを見分けること。${p.rethink_count >= 2 ? `\nこの案件はすでに集客の見直しを${p.rethink_count}回している。これ以上 rethink は選ばず、kill か improve か collect から選ぶこと。` : ""}`
    : "";
  return {
    all,
    system: `あなたは事業の撤退判断を担当するアナリストです。${isTool ? "対象は、紹介ページの中ですぐ使える「動くツール」です。" : ""}集客の数字を見て、判断します。
${options}
${budgetRule(s)}
数字が少なすぎて判断できない場合も、その旨を理由に書いたうえで最も妥当なものを選ぶこと。
improve は「今すぐ変える」場合だけに使う。「もう少し様子を見てから変える」なら collect を選ぶこと。
「ページの中での動き」があれば、どこで離脱しているか（読まれていない・ボタンが押されない・入力したのに登録しない など）を理由と next_action に活かすこと。
improve の場合、next_action には「どこを、どう変えるか」を1か所だけ、条件を付けずに具体的に書くこと（一度に複数を変えると、何が効いたか分からなくなるため）。
rethink の場合、next_action には「どこで（具体的な場所・ハッシュタグ・検索される言葉）、誰に、どんな切り口で届けるか」を具体的に書くこと。これまでの届け方と同じことは書かない。自動で投稿できるのは X・Threads・Bluesky の自分の投稿だけで、それ以外の場所は運営者の手作業になるので、自分の投稿の切り口を中心にする。他人の投稿やQ&Aサイトに宣伝のための返信・回答をする案は出さない。${slowNote}
外の声（実際の人の反応）があれば、数字と同じかそれ以上に重く見る。外の声を根拠に判断や next_action を変えたら、voice_effects に声の番号と、何をどう変えたかを書く（なければ空の配列）。
形式: {"decision":"${growing ? "improve|rethink|collect|kill" : "continue|improve|collect|rethink|kill"}","reason":"判断理由（数字を引用）","confidence":0から1,"next_action":"次にやること","voice_effects":[{"voice_ids":[声の番号],"change":"何をどう変えたか"}]}`,
    user: `サービス: ${p.title}（対象: ${p.target}）
仮説: ${p.hypothesis}
企画のときに決めた最初の届け方: ${p.first_channel ?? "（なし）"}
企画のときに決めた最初の1週間の検証: ${p.first_test ?? "（なし）"}
${p.growth_focus ? `いまの集客の方針（前回の見直しで決めたもの）: ${p.growth_focus}\n` : ""}公開してから: ${p.published_at ? `${Math.floor(daysSinceUtc(p.published_at))}日` : "不明"}${p.judged_at ? ` / 前回の判断から ${Math.floor(daysSinceUtc(p.judged_at))}日` : ""} / 集客の見直し ${p.rethink_count}回${growing ? ` / 育てる段階での実験 ${p.growth_count}回` : ""}
SNSへの投稿: ${posts}${split}
今の${isTool ? "版" : "LP"}（第${p.lp_version}版）での結果: 訪問 ${cur.visits}人 / ${c.noun} ${cur.signups}人 / ${c.rate} ${(cur.rate * 100).toFixed(1)}%
全体の結果: 訪問 ${all.visits}人 / ${c.noun} ${all.signups}人 / ${c.rate} ${(all.rate * 100).toFixed(1)}%${isTool ? ` / シェア ${shares}人` : ""} / 広告費 ${all.adSpendJpy}円
${funnelText(p)}
目標の${c.rate}: ${(targetRate(p.kind, s) * 100).toFixed(1)}% / 1案件の広告費上限: ${s.adBudgetPerProjectJpy}円 / 上限を超えたあと改善に使える追加の広告費: ${s.improveExtraBudgetJpy}円 / これまでの改善回数: ${p.improve_count}回
これまでの経過:
${history}

${outsideText(p.id)}`,
  };
}

export async function judge(projectId: number, trigger: JudgeTrigger = "visits") {
  const p = getProject(projectId)!;
  const prompt = judgePrompt(p, trigger);
  const d = await callJson<Decision>({ purpose: "判断", projectId, system: `${prompt.system}\n${EXTRAS_RULE}`, user: prompt.user, validate: isDecision });
  takeExtras(d, { modelId: getSettings().loopModel, scene: "撤退・継続の判断", projectId });
  recordVoiceEffects((d as { voice_effects?: unknown }).voice_effects, { scene: "撤退・継続の判断", modelId: getSettings().loopModel, projectId });
  logEvent(projectId, "ai", "judge", `判断を提案: ${DECISION_LABEL[d.decision]}`);
  // 同じ数字で何度も判断し直さないよう、判断した時点の訪問数と広告費を覚えておく
  db().prepare("UPDATE projects SET judged_visits = ?, judged_ad_jpy = ?, judged_at = datetime('now') WHERE id = ?").run(prompt.all.visits, prompt.all.adSpendJpy, projectId);

  const approvalId = await applyDecision(p, d, prompt.all.adSpendJpy);
  // 実際の流れを待たせないよう、裏比較は後ろで走らせる
  void shadowJudge(p, d, prompt, approvalId);
}

// AIの判断に従って次へ進める。人の承認待ちを作ったときはその id を返す
// 集客の見直し: ページは変えずに、投稿の切り口・場所・対象を変える。まだ投稿していない下書きは捨てて、新しい方針で書き直させる
async function applyRethink(projectId: number, d: Decision, by: "ai" | "human") {
  db().prepare("UPDATE projects SET growth_focus = ?, growth_focus_at = datetime('now'), rethink_count = rethink_count + 1, judged_at = datetime('now') WHERE id = ?").run(d.next_action.slice(0, 800), projectId);
  db().prepare("DELETE FROM sns_posts WHERE project_id = ? AND status = 'draft' AND author = 'ai'").run(projectId);
  if (getProject(projectId)!.growth_phase) db().prepare("UPDATE projects SET growth_count = growth_count + 1 WHERE id = ?").run(projectId);
  setStage(projectId, "live");
  logEvent(projectId, by === "ai" ? "system" : "human", "rethink", `集客を見直しました（ページは変えずに、ここから届け方を変える）: ${d.next_action}`);
}

// 「続ける」: 終わりにせず、育てる段階に入る。公開・自動投稿・定期的な判断はそのまま続き、判断では次の育てる実験を選ぶ
async function startGrowth(projectId: number, reason: string) {
  db().prepare("UPDATE projects SET growth_phase = 1, judged_at = datetime('now') WHERE id = ?").run(projectId);
  setStage(projectId, "live");
  const p = getProject(projectId)!;
  logEvent(projectId, "system", "grow", p.kind === "tool"
    ? "続けると判断。育てる段階に入りました（機能を足す・何度も使ってもらう・集客先を広げる実験を続けます）"
    : "続けると判断。需要は確認できました。育てる段階に入り、集客を広げながら登録を増やします（実際に作るかはあなたが決めます）");
  await writeLesson(projectId, `続ける（育てる段階へ）。理由: ${reason}`);
}

// 人の承認なしで改善してよいか（判断からの改善・朝会からの改善で共通）。だめなら理由を返す
// budget: 今月の予算の残りが少ない（作り直さずに今のまま集客を続ける扱いにする）
export function improveBlocked(p: ProjectRow, adSpendJpy = projectTotals(p.id).adSpendJpy): { reason: string; budget?: boolean } | null {
  const s = getSettings();
  // 今の版になってから人が改善を却下していたら、その意思を優先して自動では変えない
  const humanSaidNo = db()
    .prepare("SELECT 1 FROM approvals WHERE project_id = ? AND kind = 'decision' AND status = 'rejected' AND proposal = ? AND lp_version = ?")
    .get(p.id, DECISION_LABEL.improve, p.lp_version);
  const reason =
    p.mode !== "auto" ? "承認モードの案件は、人の承認なしでは変えないため"
    : p.kind === "tool" && !s.fullAuto ? "ツールのプログラムの変更は、人が動作を確かめてから公開するため"
    : humanSaidNo ? "この版では人が改善を却下しているため"
    : p.improve_count >= s.maxAutoImprove ? `自動での改善は${s.maxAutoImprove}回までのため`
    : adSpendJpy >= s.adBudgetPerProjectJpy + s.improveExtraBudgetJpy
      ? s.improveExtraBudgetJpy > 0
        ? "広告費が改善用の追加分も含めて上限に達しているため"
        : "広告費が上限に達していて、上限を超えたあとの改善は設定で認められていないため"
    : null;
  if (reason) return { reason };
  if (!budgetState().creativeOk) return { reason: "今月の予算の残りが少ないため", budget: true };
  return null;
}

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
    const gate = improveBlocked(p, adSpendJpy);
    if (gate?.budget) {
      // 予算の残りが少ないときは、作り直さずに今のまま集客を続ける（投稿と判断の分を残す）
      setStage(projectId, "live");
      logEvent(projectId, "system", "collect", `改善の判断でしたが、今月の予算の残りが少ないため、作り直さずに今のまま集客を続けます: ${d.next_action}`);
      return null;
    }
    if (!gate) {
      await autoImprove(projectId, d);
      return null;
    }
    const blocked = gate.reason;
    logEvent(projectId, "system", "auto-blocked", `${blocked}、人の判断に回します`);
    setStage(projectId, "deciding");
    return addApproval(projectId, "decision", DECISION_LABEL[d.decision], `${d.reason}\n（${blocked}、自動では進めずに判断をお願いしています）`, d);
  }
  // 集客の見直しは、ページもお金も変えないので、自動モードなら承認なしで進める
  if (d.decision === "rethink" && p.mode === "auto") {
    await applyRethink(projectId, d, "ai");
    return null;
  }

  // 全自動: 続ける・撤退もAIの判断のまま進める（広告費の上限を超えて集客を続けるのは、お金がかかるので人に回す）
  if (p.mode === "auto" && s.fullAuto && (d.decision === "continue" || d.decision === "kill")) {
    logEvent(projectId, "system", "auto-decision", `全自動のため、AIの判断「${DECISION_LABEL[d.decision]}」をそのまま実行しました（人の承認なし）: ${d.reason}`);
    if (d.decision === "continue") {
      await startGrowth(projectId, d.reason);
      return null;
    }
    setStage(projectId, "killed");
    await closePublic(projectId);
    await writeLesson(projectId, `${DECISION_LABEL[d.decision]}（AIが判断）。理由: ${d.reason}`);
    return null;
  }
  setStage(projectId, "deciding");
  return addApproval(projectId, "decision", DECISION_LABEL[d.decision], d.reason, d);
}

// 全自動で公開したものを、人があとから見て印を付ける。「出すべきでなかった」なら公開も止められる
export async function reviewAutoPublished(projectId: number, verdict: "ok" | "bad", note: string, stop: boolean) {
  const p = getProject(projectId);
  if (!p?.auto_published) throw new Error("人の承認なしで公開した案件ではありません");
  db().prepare("UPDATE projects SET human_review = ?, human_review_note = ?, human_review_at = datetime('now') WHERE id = ?").run(verdict, note || null, projectId);
  logEvent(projectId, "human", "human-review", verdict === "ok" ? `あとから確認: 問題なし${note ? `（${note}）` : ""}` : `あとから確認: 出すべきでなかった${note ? `（${note}）` : ""}`);
  if (verdict === "bad" && stop && !["killed", "rejected"].includes(p.stage)) {
    setStage(projectId, "killed");
    db().prepare("UPDATE projects SET end_reason = 'stopped' WHERE id = ?").run(projectId);
    await closePublic(projectId);
    logEvent(projectId, "human", "stop", "あとから確認した結果、公開を止めました");
    if (note) await writeLesson(projectId, `AIだけで公開したが、人が見て出すべきでなかったと判断。理由: ${note}`);
  }
}

// 全自動で公開したもののうち、人があとから見てダメだったものの割合
export function autoPublishStats() {
  const r = db().prepare(
    `SELECT COUNT(*) AS n, SUM(human_review IS NOT NULL) AS reviewed, SUM(human_review = 'bad') AS bad FROM projects WHERE auto_published = 1 AND demo = 0`,
  ).get() as { n: number; reviewed: number | null; bad: number | null };
  return { published: r.n, reviewed: r.reviewed ?? 0, bad: r.bad ?? 0 };
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
  isObj(v) && ["continue", "improve", "kill", "collect", "rethink"].includes(v.decision as string) && isStr(v.argument);

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
形式: {"decision":"continue|improve|collect|rethink|kill","argument":"主張","changed":true または false}`,
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

export const CHOICES: Decision["decision"][] = ["continue", "improve", "collect", "rethink", "kill"];

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
  if (c === "rethink") {
    const fromAi = proposed.decision === "rethink" ? proposed.next_action
      : (db().prepare(`SELECT next_action FROM shadow_judgments WHERE approval_id = ? AND decision = 'rethink' LIMIT 1`).get(approvalId) as { next_action: string } | undefined)?.next_action;
    return applyRethink(pid, { ...proposed, next_action: comment?.trim() || fromAi || "投稿の切り口と集客する場所を変える" }, "human");
  }
  if (c === "continue") return startGrowth(pid, `${comment ?? ""} AIの提案: ${DECISION_LABEL[proposed.decision]}（${proposed.reason}）`.trim());
  setStage(pid, "killed");
  await closePublic(pid);
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

// 毎日の計画から呼ぶ: 集客中の案件のページ（ツールなら画面）を、決めた内容で直して差し替える（チェックを通らなければ人に回す）
// 判断からの改善と同じ条件（improveBlocked）を通す。結果: published = 直して公開した / held = チェックで問題が残り承認待ちにした / blocked = 条件に合わず直さなかった
export type ImproveOutcome = { kind: "published" | "held" | "blocked"; detail: string };
export async function planImprove(projectId: number, instruction: string): Promise<ImproveOutcome> {
  const p = getProject(projectId);
  if (!p || p.demo || p.stage !== "live") return { kind: "blocked", detail: "集客中の案件ではないため" };
  if (buildingNow(projectId)) return { kind: "blocked", detail: "この案件は、いま作業中のため" };
  if (db().prepare("SELECT 1 FROM approvals WHERE project_id = ? AND status = 'pending'").get(projectId)) return { kind: "blocked", detail: "この案件には承認待ちがあるため" };
  const gate = improveBlocked(p);
  if (gate) return { kind: "blocked", detail: gate.reason };
  return autoImprove(projectId, { next_action: instruction } as Decision);
}

async function autoImprove(projectId: number, d: Decision): Promise<ImproveOutcome> {
  const built = await buildLpVersion(projectId, { instruction: d.next_action, note: `自動改善: ${d.next_action}`, keepCore: true });
  const { version } = built;
  let review = built.review;
  // 動くツールは、ブラウザでの自動テストも通ったものだけ自動で差し替える
  if (getProject(projectId)!.kind === "tool") {
    const row = db().prepare("SELECT test FROM lp_versions WHERE project_id = ? AND version = ?").get(projectId, version) as { test: string | null } | undefined;
    const t = row?.test ? (JSON.parse(row.test) as ToolTest) : null;
    if (!t || (!t.skipped && !t.ok)) review = { ok: false, issues: [...review.issues, ...(t ? testIssues(t) : ["ブラウザでの自動テストの結果がない"])] };
  }
  if (!review.ok) {
    // チェックを通らない改善は公開せず、人に回す
    setStage(projectId, "lp");
    addApproval(projectId, "publish", getProject(projectId)!.kind === "tool" ? "改善したツールを公開する" : "改善したLPを公開する", `AIのチェックで問題が残ったため、自動公開を止めました: ${review.issues.join(" / ")}`, { review });
    return { kind: "held", detail: `第${version}版を作ったが、チェックで問題が残ったため公開せず承認待ちにした: ${review.issues.join(" / ").slice(0, 200)}` };
  }
  db().prepare("UPDATE projects SET improve_count = improve_count + 1, growth_count = growth_count + growth_phase WHERE id = ?").run(projectId);
  setStage(projectId, "live");
  logEvent(projectId, "system", "auto-improve", `自動で${getProject(projectId)!.kind === "tool" ? "ツール" : "LP"}を改善し、第${version}版で集客を再開（人の承認なし）`);
  // すでに公開中なら、新しい版に差し替える
  if (getProject(projectId)!.public_slug) await announcePublish(projectId);
  return { kind: "published", detail: `第${version}版に直して公開した` };
}

// ---- 4. 教訓メモ ----

// 少ない数字から強い結論を作らないよう、「観測した事実」「仮の解釈」「まだ判断できないこと」に分けて残す
// 訪問が判断の基準に届いていない案件は、確かさを「低（保留）」に固定する
type Certainty = "low" | "mid" | "high";
export const CERTAINTY_LABEL: Record<Certainty, string> = { low: "低（データ不足・保留）", mid: "中", high: "高" };

async function writeLesson(projectId: number, outcome: string) {
  const p = getProject(projectId)!;
  const s = getSettings();
  const t = projectTotals(projectId);
  const enough = t.visits >= s.judgeMinVisits;
  const reach = classifyEnd(p);
  const posts = (db().prepare("SELECT COUNT(*) AS n FROM sns_posts WHERE project_id = ? AND status = 'posted'").get(projectId) as { n: number }).n;
  const out = await callJson<{ fact: string; interpretation: string; unknown: string; certainty: Certainty }>({
    purpose: "教訓メモ",
    projectId,
    system: `終わった案件から、次のアイデア出しに活かせる教訓を書きます。少ない数字から強い結論を作らないことが最も大切です。次の3つに分けて書きます。
- fact: 観測した事実だけ（数字・したこと）。解釈を混ぜない
- interpretation: 事実から考えられる仮の解釈を1〜2文。次の案件にも当てはまりそうな形で書く。言い切らず「〜かもしれない」の確かさで書く
- unknown: この結果からは、まだ判断できないこと（例: 届いた人が少なく、需要の有無は分からない）
- certainty: 解釈の確かさ。low / mid / high
守ること:
- 訪問が判断の基準（${s.judgeMinVisits}人）に届いていなければ、certainty は必ず low。需要の有無・対象者の良し悪しについて結論を出さない
- ほとんど人に届いていない（「届かなかった」）場合、学べるのは届け方のことだけ。「この対象には需要がない」「この題材は弱い」とは書かない
形式: {"fact":"","interpretation":"","unknown":"","certainty":"low"}
${EXTRAS_RULE}`,
    user: `サービス: ${p.title}（対象: ${p.target}）\n結果: ${outcome}\n形: ${KIND_LABEL[p.kind]}\n訪問 ${t.visits}人（判断の基準 ${s.judgeMinVisits}人${enough ? "に届いている" : "に届いていない"}） / ${CONV[p.kind].noun} ${t.signups}人 / ${CONV[p.kind].rate} ${(t.rate * 100).toFixed(1)}% / 改善 ${p.improve_count}回 / 集客の見直し ${p.rethink_count}回 / SNSへの投稿 ${posts}件\n終わり方の分類: ${END_REASON_LABEL[reach] ?? reach}\n最初の届け方: ${p.first_channel ?? "（なし）"}${p.growth_focus ? `\n最後の集客の方針: ${p.growth_focus}` : ""}`,
    validate: (v): v is { fact: string; interpretation: string; unknown: string; certainty: Certainty } => isObj(v) && isStr(v.fact) && isStr(v.interpretation),
  });
  takeExtras(out, { modelId: s.loopModel, scene: "教訓を書くとき", projectId });
  const certainty: Certainty = !enough ? "low" : (["low", "mid", "high"] as const).includes(out.certainty) ? out.certainty : "low";
  const unknown = isStr(out.unknown) ? out.unknown.slice(0, 400) : "";
  db().prepare("INSERT INTO lessons (project_id, text, fact, interpretation, unknown, certainty) VALUES (?, ?, ?, ?, ?, ?)")
    .run(projectId, out.interpretation.slice(0, 400), out.fact.slice(0, 400), out.interpretation.slice(0, 400), unknown || null, certainty);
  logEvent(projectId, "ai", "lesson", `教訓を記録（確かさ: ${CERTAINTY_LABEL[certainty]}）: ${out.interpretation}`);
}

// アイデア出しに渡す形（確かさと、まだ分からないことも一緒に渡す）
export function lessonLine(l: LessonRow): string {
  if (!l.fact) return `- ${l.text}`;
  return `- [確かさ: ${CERTAINTY_LABEL[l.certainty ?? "low"]}] 事実: ${l.fact} / 仮の解釈: ${l.interpretation ?? l.text}${l.unknown ? ` / まだ分からない: ${l.unknown}` : ""}`;
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
  if (d.decision === "rethink") return applyRethink(pid, d, "human");
  if (d.decision === "continue") return startGrowth(pid, d.reason);
  setStage(pid, "killed");
  await closePublic(pid);
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
// AIのチェックの指摘から、直すための指示文を作る（AIは使わない。指摘そのものが具体的なので、そのまま渡す）
export function fixInstruction(issues: string[]): string {
  return `AIのチェックで見つかった次の問題だけを直すこと。それ以外（世界観・見た目・文言・機能）は今のまま残す。\n${issues.map((x, i) => `${i + 1}. ${x.replace(/^デザイン: /, "")}`).join("\n")}`;
}

// 判断待ちの公開を、チェックの指摘に沿ってAIに直させる。直した版がチェックを通り、全自動の案件なら、そのまま公開する
export async function autoFixPublish(approvalId: number, instruction?: string) {
  const a = db().prepare("SELECT * FROM approvals WHERE id = ?").get(approvalId) as ApprovalRow | undefined;
  if (!a || a.kind !== "publish" || a.status !== "pending") throw new Error("直せる公開の承認待ちが見つかりません");
  const review = (JSON.parse(a.payload ?? "{}") as { review?: Review }).review;
  const text = instruction?.trim() || (review?.issues.length ? fixInstruction(review.issues) : "");
  if (!text) throw new Error("直す内容がありません（チェックの指摘がないため）");
  db().prepare("UPDATE approvals SET status = 'revised', comment = ?, decided_at = datetime('now') WHERE id = ?").run(text.slice(0, 1000), approvalId);
  logEvent(a.project_id, "human", "auto-fix", `チェックの指摘に沿って、AIに直させました${instruction?.trim() ? "（指示を確認して送信）" : ""}`);
  const p = getProject(a.project_id)!;
  // まだ一度も公開していない全自動の案件は、直した版がチェックを通れば、最初に作ったときと同じように自動で公開する
  await prepareLp(a.project_id, text, { keepCore: true, byHuman: true, auto: p.mode === "auto" && !p.public_slug });
}

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

// 今の版のイラストを描き直す・外す（案件の画面のボタンから）。公開中の版なら公開サイトにも反映する
export async function changeIllustration(projectId: number, action: "redraw" | "remove") {
  const p = getProject(projectId);
  if (!p?.lp) throw new Error("まだLPがありません");
  let lp = JSON.parse(p.lp) as Lp;
  if (!lp.design) throw new Error("このLPには見た目の設定がありません（古い形式のため）");
  if (action === "remove") {
    lp = { ...lp, design: { ...lp.design, illustration: undefined } };
  } else {
    const drawn = await withIllustration(p, { ...lp, design: { ...lp.design, illustration: undefined } }, p.lp_version, { force: true });
    if (drawn.note) throw new Error(drawn.note);
    lp = drawn.lp;
  }
  db().prepare("UPDATE projects SET lp = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(lp), projectId);
  db().prepare("UPDATE lp_versions SET lp = ? WHERE project_id = ? AND version = ?").run(JSON.stringify(lp), projectId, p.lp_version);
  logEvent(projectId, "human", "illustration", action === "remove" ? "イラストを外しました" : "イラストを描き直しました");
  const now = getProject(projectId)!;
  if (now.public_slug && now.public_version === now.lp_version && now.stage !== "killed") await announcePublish(projectId);
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
      logEvent(projectId, "system", "publish", `第${p.lp_version}版の${p.kind === "tool" ? "ツール" : "LP"}を公開しました: ${publicUrl(projectId) ?? slugOf(projectId)}`);
      db().prepare("UPDATE projects SET published_at = COALESCE(published_at, datetime('now')) WHERE id = ?").run(projectId);
      // 無料の場所（Threads・Bluesky）には、公開したその場で1件投稿する（まだ投稿していない場所だけ）
      const { postOnPublish } = await import("./sns");
      await postOnPublish(projectId);
      return;
    }
  } catch (e) {
    logEvent(projectId, "system", "publish-error", (e instanceof Error ? e.message : String(e)).slice(0, 300));
    return;
  }
  logEvent(projectId, "system", "publish", `第${p.lp_version}版の${p.kind === "tool" ? "ツール" : "LP"}で集客を開始（公開用サイトが未設定のため、手動で公開する前提）`);
}

// 撤退した理由を、数字から3つに分ける（AIは使わない）
// - unreached: 届かなかった（訪問が少ない）
// - unused: 届いたが使われなかった・登録されなかった（成果の率が目標の半分未満）
// - unspread: 使われたが広まらなかった・続かなかった（成果はあるが伸びなかった）
export const END_REASON_LABEL: Record<string, string> = {
  unreached: "届かなかった", unused: "届いたが使われなかった", unspread: "使われたが広まらなかった", stopped: "人が止めた",
};

function classifyEnd(p: ProjectRow): string {
  const s = getSettings();
  const t = projectTotals(p.id);
  if (t.visits < Math.max(20, s.judgeMinVisits * 0.3)) return "unreached";
  if (t.rate < targetRate(p.kind, s) * 0.5) return "unused";
  return "unspread";
}

async function closePublic(projectId: number) {
  const p = getProject(projectId)!;
  db().prepare("UPDATE projects SET end_reason = COALESCE(end_reason, ?) WHERE id = ?").run(classifyEnd(p), projectId);
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
  // 訪問が少なくても、公開（または前の判断）から決めた日数がたったら判断する（人が来ないまま止まり続けないように）
  const publishedAt = p.published_at ?? backfillPublishedAt(p);
  const since = p.judged_at ?? publishedAt;
  const slow = !!since && daysSinceUtc(since) >= s.judgeAfterDays;
  if (!enoughVisits && !budgetHit && !slow) return false;
  await judge(projectId, enoughVisits ? "visits" : budgetHit ? "budget" : "slow");
  return true;
}

// 公開した日時がまだ記録されていない案件（この仕組みを入れる前に公開したもの）は、最初の公開の記録から埋める
function backfillPublishedAt(p: ProjectRow): string | null {
  const first = db().prepare("SELECT MIN(at) AS at FROM events WHERE project_id = ? AND kind IN ('publish', 'auto-publish')").get(p.id) as { at: string | null };
  if (first.at) db().prepare("UPDATE projects SET published_at = ? WHERE id = ?").run(first.at, p.id);
  return first.at;
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
    // 育てる段階に入った案件は数えない（うまくいった案件があっても、新しいアイデアは止めない）
    const live = (db().prepare("SELECT COUNT(*) AS n FROM projects WHERE stage = 'live' AND demo = 0 AND growth_phase = 0").get() as { n: number }).n;
    if (pending >= s.maxPending) return skip(`承認待ちが${pending}件たまっているため、アイデア出しを休みました（上限${s.maxPending}件）`);
    if (live >= s.maxLive) return skip(`集客中の案件が${live}件あるため、アイデア出しを休みました（上限${s.maxLive}件）`);
    const paused = planPausesNew();
    if (paused) return skip(`今日の計画で、新しい案件づくりを休むと決めたため休みました（${paused}）`);

    // 月の予算のペースに合わせて、今日新しく作る案件の数を決める（1件ごとの作り方は変えない）
    const b = budgetState();
    if (!b.creativeOk) return skip(`今月の予算の${Math.round((b.creativeCap / b.budget) * 100)}%を使ったため、新しい案件は休みました（残りはSNSの投稿と判断に使います）`);
    if (b.newToday === 0) return skip(`予算のペースを守るため、今日は新しい案件を休みました（今日使える額 約${Math.round(b.allowanceToday)}円・1件 約${Math.round(b.perProject)}円）`);
    // ほかのアイデア出しが動いていたら、今回は見送って次の確認（5分後）に回す（実行済みの印は付けない）
    const busy = ideaRunning();
    if (busy) return { ran: false, message: `いま「${busy}」が動いているため、終わってから実行します`, projectIds: [] };
    const { candidates, kept } = await withIdeaLock("毎日のアイデア出し", () => gatherAndScoreIdeas(s.dailyIdeaCount, b.newToday));
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

// アイデア出しは、同時に1つだけ動かす（毎日の自動実行・ホームの入力欄・ライブ画面の「見るだけ」・仮テスト）
// 同時に動くと、どちらも同じ「既にある案件・最近出た案」を見て似た案を出し、費用も予算の計算も重なるため
const gIdea = globalThis as unknown as { __aiLabIdeaRun?: string };
export const ideaRunning = (): string | null => gIdea.__aiLabIdeaRun ?? null;
export class IdeaBusyError extends Error {}
async function withIdeaLock<T>(label: string, fn: () => Promise<T>): Promise<T> {
  if (gIdea.__aiLabIdeaRun) throw new IdeaBusyError(`いま「${gIdea.__aiLabIdeaRun}」が動いています。終わってからもう一度押してください`);
  gIdea.__aiLabIdeaRun = label;
  try {
    return await fn();
  } finally {
    gIdea.__aiLabIdeaRun = undefined;
  }
}

// アイデアを出すAI: 各社の上位モデル（キーがあるもの）
export function ideaAuthors(): string[] {
  return MODELS.filter((m) => m.tier === "top" && hasKey(m.provider)).map((m) => m.id);
}

async function gatherAndScoreIdeas(perModel: number, keep: number, practice = false, opts: { title?: string; alsoExisting?: string[]; theme?: string } = {}): Promise<{ candidates: Candidate[]; kept: Candidate[] }> {
  const authors = ideaAuthors();
  const batchId = `${Date.now()}`;
  const act = `ideas-${batchId}`;
  const title = opts.title ?? (practice ? "アイデア出し（見るだけ）" : "毎日のアイデア出し");
  const prov = (id: string) => modelInfo(id).provider;
  try {
  authors.forEach((a) => setStep(act, title, modelLabel(a), "アイデアを考えています"));

  // 1. 各社にアイデアを出させる（失敗したAIは飛ばす）。届いた順に、ライブ画面にすぐ出す
  const results = await Promise.all(
    authors.map(async (author) => {
      try {
        const ideas = await askIdeas(opts.theme ?? "", perModel, author, opts.alsoExisting);
        setStep(act, title, modelLabel(author), `アイデア${ideas.length}件を出しました。ほかの社を待っています`);
        for (const idea of ideas) {
          liveNote({ who: modelLabel(author), provider: prov(author), kind: `アイデアを提案（${idea.kind === "tool" ? "動くツール" : "事前登録LP"}・${idea.season === "seasonal" ? "季節もの" : "1年中"}）`, text: `「${idea.title}」— ${idea.solution}${idea.channel ? `\n届け方: ${idea.channel}` : ""}`, batch: batchId });
        }
        return ideas.map((idea) => ({ author, idea }));
      } catch (e) {
        setStep(act, title, modelLabel(author), "失敗しました");
        logEvent(null, "system", "idea-error", `${modelLabel(author)}のアイデア出しに失敗: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`);
        return [];
      }
    }),
  );
  // 2. 順番を混ぜて、A, B, C... の伏せ字を付ける（作者の並び順で見抜かれないように）
  const pool = results.flat().sort(() => Math.random() - 0.5);
  if (!pool.length) return { candidates: [], kept: [] };
  const insert = db().prepare("INSERT INTO idea_candidates (batch_id, label, author_model, title, payload, practice) VALUES (?, ?, ?, ?, ?, ?)");
  const candidates: Candidate[] = pool.map((x, i) => {
    const label = String.fromCharCode(65 + i);
    const id = Number(insert.run(batchId, label, x.author, x.idea.title, JSON.stringify(x.idea), practice ? 1 : 0).lastInsertRowid);
    return { id, label, author: x.author, idea: x.idea, avg: 0, peerAvg: null };
  });

  // 3. 各社が、作者を伏せた全候補に点を付ける
  const sheet = candidates
    .map((c) => `【${c.label}】${c.idea.title}（形: ${c.idea.kind === "tool" ? "tool" : "lp"}）\n対象: ${c.idea.target}\n課題: ${c.idea.problem}\n解決策: ${c.idea.solution}\n仮説: ${c.idea.hypothesis}\n需要の時期: ${c.idea.season === "seasonal" ? "季節もの" : c.idea.season === "evergreen" ? "1年中" : "（書かれていない）"}\n最初の届け方: ${c.idea.channel ?? "（書かれていない）"}\n最初の1週間の検証: ${c.idea.first_test ?? "（書かれていない）"}${wantLine(c.idea.want_id)}`)
    .join("\n\n");
  const scoreRow = db().prepare("INSERT INTO idea_scores (candidate_id, scorer_model, score, reason) VALUES (?, ?, ?, ?)");
  authors.forEach((a) => setStep(act, title, modelLabel(a), `作者を伏せた${candidates.length}件を採点しています`));
  await Promise.all(
    authors.map(async (scorer) => {
      try {
        const out = await callJson<{ scores: { label: string; score: number; reason: string }[] }>({
          purpose: "アイデアの採点",
          modelId: scorer,
          system: `あなたは事業アイデアの審査員です。作者が誰かは分かりません。次の観点で各アイデアを1〜10点で採点します。
- 対象者が具体的で、その人に安く届けられるか
- 「最初の届け方」が具体的で現実的か（広告なし・フォロワーほぼ0のアカウントと手作業で、本当に最初の利用者に会えるか）。曖昧なもの・書かれていないものは大きく減点する。自分の投稿（タグ付け）だけで、運営者が手でできる直接の接点（コミュニティの管理者への相談・知人に使ってもらう など）が入っていないものも減点する。他人の投稿への宣伝の返信・知らない人へのDMを使う案は大きく減点する
- 困りごと・欲しい気持ちが強く、事前登録したくなるか（形が tool なら、使ってシェアしたくなるか）
- 選んだ形（lp=事前登録LP / tool=1ページで完結する動くツール）が、そのアイデアに合っているか。tool なら外部の通信なしで本当に作れるか
- プロダクトの種類（Webサービス・スマホアプリ・拡張機能・ボット・デジタル商品など）では差をつけない。lp は作る前に需要を確かめるものなので、作るのが大変なことでは減点しない
- 既存の無料サービスとの違いがはっきりしているか
- 季節が過ぎても需要が残るか。季節もの（その時期だけ使われるもの）は、時期が過ぎたあとも使われる理由がなければ減点する（公開から判断まで1〜3週間かかり、育てる時間もいるため）
点数は甘くしないこと（平凡なものは5点前後）。
形式: {"scores":[{"label":"A","score":1から10の数値,"reason":"理由を1文で"}]}${practice ? "" : `\n${EXTRAS_RULE}`}`,
          user: opts.theme ? `依頼されたテーマ: ${opts.theme}（テーマから外れたものは減点する）\n\n${sheet}` : sheet,
          validate: (v): v is { scores: { label: string; score: number; reason: string }[] } =>
            isObj(v) && Array.isArray(v.scores) && v.scores.every((x) => isObj(x) && isStr(x.label) && typeof x.score === "number"),
        });
        if (!practice) takeExtras(out, { modelId: scorer, scene: "アイデア会議の採点" });
        for (const sc of out.scores) {
          const c = candidates.find((x) => x.label === sc.label.trim().replace(/[【】]/g, ""));
          if (c) scoreRow.run(c.id, scorer, Math.max(1, Math.min(10, sc.score)), typeof sc.reason === "string" ? sc.reason : null);
        }
        setStep(act, title, modelLabel(scorer), "採点が終わりました");
      } catch (e) {
        setStep(act, title, modelLabel(scorer), "採点に失敗しました");
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
  if (!practice) proposeRevival(candidates.filter((c) => !kept.includes(c)));
  const best = [...candidates].sort((a, b) => b.avg - a.avg)[0];
  if (best) liveNote({ who: "システム", provider: null, kind: "採点の結果", text: `1位は「${best.idea.title}」（${modelLabel(best.author)}の案・平均${best.avg.toFixed(1)}点）${practice ? "。見るだけなので、案件にはしません" : kept.length ? `。上位${kept.length}件を案件にします` : ""}`, batch: batchId });
  return { candidates, kept };
  } finally {
    activities.delete(act);
  }
}

// 敗者復活: 選ばれなかった案のうち、平均7点以上か、作者ではない会社のAIが9点以上を付けた案を、1日1件まで提案箱に入れる
// （自分の案を推すのではなく、他社が「これは良い」と言った案が復活する形）
function proposeRevival(losers: Candidate[]) {
  if (db().prepare("SELECT 1 FROM plan_requests WHERE source = 'revival' AND created_at >= datetime('now', '-1 day')").get()) return;
  const best = losers
    .map((c) => ({ c, top: db().prepare("SELECT scorer_model, score, reason FROM idea_scores WHERE candidate_id = ? AND scorer_model != ? ORDER BY score DESC LIMIT 1").get(c.id, c.author) as { scorer_model: string; score: number; reason: string | null } | undefined }))
    .filter((x) => x.c.avg >= 7 || (x.top && x.top.score >= 9))
    .sort((a, b) => b.c.avg - a.c.avg)[0];
  if (!best) return;
  const { c, top } = best;
  addProposal({
    title: `敗者復活「${c.idea.title}」`,
    how: `対象: ${c.idea.target} / 困りごと: ${c.idea.problem} / 解決策: ${c.idea.solution}（形: ${c.idea.kind === "tool" ? "動くツール" : "事前登録LP"}）`,
    why: `${top ? `${modelLabel(top.scorer_model)}が${top.score}点（${top.reason ?? ""}）。` : ""}平均 ${c.avg.toFixed(1)}点で、作る件数の枠から漏れた（作者は ${modelLabel(c.author)}）`,
    target: "human", source: "revival", proposer: top?.scorer_model ?? c.author, scene: "アイデア会議", refId: c.id,
  });
}

// 敗者復活の案で、案件を作る（提案箱のボタンから。ふだんの作り方で作る）
export async function reviveIdea(requestId: number): Promise<number> {
  const r = db().prepare("SELECT * FROM plan_requests WHERE id = ? AND source = 'revival' AND status = 'open'").get(requestId) as { ref_id: number | null; title: string } | undefined;
  if (!r?.ref_id) throw new Error("敗者復活の提案が見つかりません");
  const row = db().prepare("SELECT * FROM idea_candidates WHERE id = ?").get(r.ref_id) as { id: number; author_model: string; payload: string; avg_score: number | null; selected: number } | undefined;
  if (!row || row.selected) throw new Error("この案は、すでに案件になっています");
  const idea = JSON.parse(row.payload) as Idea;
  const peer = db().prepare("SELECT AVG(score) AS a FROM idea_scores WHERE candidate_id = ? AND scorer_model != ?").get(row.id, row.author_model) as { a: number | null };
  const conf = peer.a !== null ? { value: peer.a / 10, source: "他社のAIによる採点の平均" } : selfConfidence(idea);
  const id = insertProject(idea, "", { ...nextMode(conf), confidence: conf.value }, "manual", row.author_model);
  db().prepare("UPDATE idea_candidates SET selected = 1, project_id = ? WHERE id = ?").run(id, row.id);
  db().prepare("UPDATE plan_requests SET status = 'done', note = ?, decided_at = datetime('now') WHERE id = ?").run(`案件 #${id} を作った`, requestId);
  logEvent(id, "human", "select", `敗者復活: 提案箱から「${idea.title}」を案件にしました（平均 ${row.avg_score?.toFixed(1) ?? "—"}点）`);
  void startProject(id).catch((e) => logEvent(id, "system", "lp-error", `作成に失敗: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`));
  return id;
}

// 採点の表に載せる、元になった声（実際にXで欲しいと言われているか）
function wantLine(id: number | undefined): string {
  const w = typeof id === "number" ? getWant(id) : undefined;
  return w?.status === "ok" ? `\n元になった声: Xの投稿（いいね${w.likes ?? 0}）「${w.problem}」` : "";
}

// 仮テスト: 毎朝のアイデア出しと同じ形（各社 設定の件数ずつ・上位を選ぶ）を、案件にせずに何日分か続けて回す
// 前の日に選ばれたアイデアは「既にある案件」として次の日に渡す。選ばれたものには selected の印を付ける（成績には数えない）
export async function simulateDays(days: number): Promise<{ day: number; batch: string; kept: string[] }[]> {
  return withIdeaLock(`アイデア出しの仮テスト（${days}日分）`, () => simulate(days));
}

async function simulate(days: number): Promise<{ day: number; batch: string; kept: string[] }[]> {
  const s = getSettings();
  const picked: string[] = [];
  const out: { day: number; batch: string; kept: string[] }[] = [];
  for (let d = 1; d <= days; d++) {
    const { candidates, kept } = await gatherAndScoreIdeas(s.dailyIdeaCount, s.dailyKeep, true, { title: `アイデア出しの仮テスト（${d}/${days}日目）`, alsoExisting: picked });
    for (const k of kept) {
      db().prepare("UPDATE idea_candidates SET selected = 1 WHERE id = ?").run(k.id);
      picked.push(k.idea.title);
    }
    const batch = candidates[0] ? (db().prepare("SELECT batch_id FROM idea_candidates WHERE id = ?").get(candidates[0].id) as { batch_id: string }).batch_id : "";
    out.push({ day: d, batch, kept: kept.map((k) => k.idea.title) });
  }
  logEvent(null, "ai", "idea-practice", `アイデア出しの仮テストを${days}日分回しました（案件にはしていません）: ${out.map((o) => `${o.day}日目 ${o.kept.join("・") || "なし"}`).join(" / ")}`);
  return out;
}

// ライブ画面から: 3社にアイデアを出させて採点するところまでを見る（案件にはしない・成績にも数えない）
export async function practiceIdeas(): Promise<number> {
  return withIdeaLock("アイデア出し（見るだけ）", async () => {
    const { candidates } = await gatherAndScoreIdeas(1, 0, true);
    logEvent(null, "ai", "idea-practice", `アイデア出しだけを見ました（${candidates.length}件。案件にはしていません）`);
    return candidates.length;
  });
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
  const authors = [...new Set((db().prepare("SELECT DISTINCT author_model AS a FROM idea_candidates WHERE practice = 0").all() as { a: string }[]).map((r) => r.a))];
  return authors.map((author) => {
    const cands = db().prepare("SELECT * FROM idea_candidates WHERE author_model = ? AND practice = 0").all(author) as { id: number; selected: number; project_id: number | null }[];
    const ids = cands.map((c) => c.id).join(",") || "NULL";
    const fromOthers = db().prepare(`SELECT AVG(score) AS a, COUNT(*) AS n FROM idea_scores WHERE candidate_id IN (${ids}) AND scorer_model != ?`).get(author) as { a: number | null; n: number };
    const fromSelf = db().prepare(`SELECT AVG(score) AS a FROM idea_scores WHERE candidate_id IN (${ids}) AND scorer_model = ?`).get(author) as { a: number | null };
    // この作者が他社の案に付けた点（自分の案への点と比べて、身内びいきかを見る）
    const givenToOthers = db()
      .prepare("SELECT AVG(s.score) AS a FROM idea_scores s JOIN idea_candidates c ON c.id = s.candidate_id WHERE s.scorer_model = ? AND c.author_model != ? AND c.practice = 0")
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
      continued: mine.filter((p) => p.stage === "continued" || p.growth_phase).length,
      killed: mine.filter((p) => p.stage === "killed").length,
      costUsd: cost,
    };
  });
}
