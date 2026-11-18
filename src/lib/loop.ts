import fs from "node:fs";
import { searchBeforeIdeas, viralHints } from "./viralPosts";
import { makePlayVideoOnPublish } from "./playVideo";
import { hitsText } from "./hits";
import { NEED_KINDS, needsOf, needsWaiting, notReady, type Need } from "./needs";
import { AIMS, AIM_KEYS, GENRES, aimOfIdea, aimWeightsOf, alignIdeaAims, allocateAims, dealAims, genresOf, isAim, pickByAims, type Aim } from "./aims";
import { getWant, wantsText } from "./userWants";
import { callClaude, callJson, callLong, claudeModelId, isObj, isStr } from "./ai";
import { DESIGN_OPTIONS, ICONS, PREVIEW_KINDS, SECTIONS, THEMES, TOOL_DATA_ROWS_MAX, TOOL_DEEP_CODE_MAX, TOOL_HTML_MAX, TOOL_RESULTS_MAX, TOOL_RESULT_LEN, isLpCore, normalizeLp, type Lp } from "../../lp-site/src/lp/content";
import { hasResultsTag, toolResultsOf } from "../../lp-site/src/lp/htmlDom";
import { MODELS, hasKey, modelInfo } from "./models";
import { screenshotPath, testIssues, testTool, type ToolTest } from "./toolTest";
import { seasonalContext } from "./season";
import { trendsText } from "./trends";
import { withIllustration } from "./illustration";
import { buildPage, judgePages, pageTexts, type PageCheck } from "./freePage";
import { funnelText } from "./funnel";
import { planIdeaNote, planPausesNew } from "./plan";
import { EXTRAS_RULE, addProposal, takeExtras } from "./voices";
import { CANVAS_HELPERS_JS } from "./toolParts";
import { outsideText, recordVoiceEffects } from "./outside";
import { notifyEvent, notifyHuman } from "./liveNotify";
import { researchText } from "./research";
import { budgetState } from "./budget";
import { deepAllowance, draftDeepData, parseUploadedData, sampleRows, type DeepRow, type DeepSpec } from "./deep";
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
  alternative?: string; // 代わりになる既存の無料サービス（名前）と、それとの違い
  season?: "seasonal" | "evergreen"; // 季節もの（その時期だけ）か、1年中ある困りごとか
  want_id?: number; // 元にした「欲しい」の声（user_wants）の番号
  deep?: string; // じっくり案件にするとき: ふつうの tool の制限を外して、何を作り込むか
  deep_data?: string; // じっくり案件で大きなデータが要るときだけ: 要るデータ（何の一覧で、1件ごとに何を持ち、何件くらいか・鮮度）
  // 使えたら明らかに良くなる外部の API（今は通信を止めているので使わない。何がどれだけ欲しがられたかを記録し、許すかを人が決める材料にする）
  api_wish?: { name: string; purpose: string; key: boolean; sends: string };
  needs?: Need[]; // じっくり案件で、作るのに要るもの（保存の場所・外部のAPI・その場でAIを呼ぶ など。今はない仕組みが要るなら、人の作業待ちで止める）
  aim?: Aim; // ねらい（aims.ts）。形（kind）はねらいから決まる
  genre?: string; // ジャンル（短い言葉）
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
  live: "公開中・集客中",
  hold: "公開中・集客お休み",
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

// じっくり案件として作る案か（tool で、要るデータが書かれているもの）
export const isDeepIdea = (idea: Idea): boolean => idea.kind === "tool" && typeof idea.deep === "string" && idea.deep.trim().length > 0;

const isIdea = (v: unknown): v is Idea =>
  isObj(v) && ["title", "target", "problem", "solution", "hypothesis", "reason"].every((k) => isStr(v[k]));

const isLp = (v: unknown): v is Lp => isLpCore(v);

const isDecision = (v: unknown): v is Decision =>
  isObj(v) && ["continue", "improve", "kill", "collect", "rethink"].includes(v.decision as string) && isStr(v.reason) && isStr(v.next_action);

export const isReview = (v: unknown): v is Review => isObj(v) && typeof v.ok === "boolean" && Array.isArray(v.issues) && v.issues.every(isStr);

// ---- 共通 ----

export function logEvent(projectId: number | null, actor: "ai" | "human" | "system", kind: string, message: string) {
  db().prepare("INSERT INTO events (project_id, actor, kind, message) VALUES (?, ?, ?, ?)").run(projectId, actor, kind, message);
  notifyEvent(kind, actor, projectId ? `${projectTitle(projectId)}${message}` : message);
}

// 通知の頭に付ける案件の名前
function projectTitle(id: number): string {
  const t = (db().prepare("SELECT title FROM projects WHERE id = ?").get(id) as { title: string } | undefined)?.title;
  return t ? `【${t}】` : "";
}

function setStage(projectId: number, stage: Stage) {
  db().prepare("UPDATE projects SET stage = ?, updated_at = datetime('now') WHERE id = ?").run(stage, projectId);
}

// どのLPの版について聞いたかも残す（人が却下した版で、AIが勝手に変えないようにするため）
function addApproval(projectId: number, kind: ApprovalRow["kind"], proposal: string, reason: string, payload?: unknown): number {
  notifyHuman(`${projectTitle(projectId)}あなたの判断待ち: ${proposal}（${reason.slice(0, 120)}）`);
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
// deepOnly: 運営者が「じっくり案件だけ」を頼んだとき。全件を tool のじっくり案件で出させ、そうでない案は捨てる
export async function askIdeas(theme: string, count: number, modelId?: string, alsoExisting: string[] = [], deepOnly = false, aims: Aim[] = []): Promise<Idea[]> {
  const s = getSettings();
  if (aims.length) count = aims.length;
  const genres = genresOf(s.ideaGenres);
  // 最近14日の案件のジャンル（重なりを除いて全部、新しい順）
  const recentGenres = (db().prepare("SELECT genre, MAX(id) AS last FROM projects WHERE demo = 0 AND genre IS NOT NULL AND created_at >= datetime('now', '-14 days') GROUP BY genre ORDER BY last DESC").all() as { genre: string }[]).map((r) => r.genre);
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
世に出す形（kind）は2つあり、下に書くねらい（aim）から決まります（demand は lp、ほかは tool）。
- lp: 事前登録LP。まだ作らずに、紹介ページのメール事前登録で需要を確かめる。プロダクトの種類も、作る大変さも問わない（需要が確かめられてから作る）。継続して使うもの・作るのに時間がかかるもの向け
- tool: 動くツール。診断・シミュレーター・計算機・ジェネレーターなど、1つのWebページの中だけで完結して今すぐ使えるもの。外部のAPIやサーバー、ログイン、ブラウザの保存領域（localStorage など）は使えない。記録や保存が欲しい案は、solution に「画面を閉じると消える一時的な保持」と明記する。何度も使いたくなるもの・結果を人に見せたくなるものが向く
- じっくり案件（tool のみ）: ふつうの tool の制限（40,000文字まで・データは代表的なものだけ・フォントなし・AIが1回で書き上げる）を外し、時間をかけて作り込む枠（直近7日で${s.deepPerWeek}件まで）。AIが設計書を書き、開発担当（Claude Code）がブラウザで確かめながら作る。コードは${TOOL_HTML_MAX.toLocaleString("en-US")}文字まで、Google Fonts が使える。制限のせいで小さく縮めるしかない案は、縮めずに deep に何を作り込むか（見せ方・演出・データの大きさなど）を書いて出してよい。deep は、ふつうの tool では面白さが出ない案だけに書く
- じっくり案件で大きなデータ（数百〜${TOOL_DATA_ROWS_MAX}件ほどの一覧。例: 全国の市町村ごとの特徴・数百の職業の特徴）が要るときだけ、deep_data に要るデータ（何の一覧で、1件ごとに何を持ち、何件くらいか）を書く。AIがデータを下書きし、人が確かめてから作る。deep_data には、データがどのくらいの頻度で変わるか（変わらない・年1回・毎月など）と、変わるときに誰がどう更新するかも書く（すぐ古くなるデータ（売り場・配信作品・価格など）は、更新の手立てがなければ出さない）。データが要らないじっくり案件は deep_data を書かない
- 外部の API・サービスは今は使えない（通信は止めている）。使えたら明らかに良くなる、または使えないと作れない API があれば、api_wish に書く（API の名前・何に使うか・鍵（APIキー）が要るか・訪問者のどんな情報を送ることになるか）。人が、その API を許すかを決める材料として記録する。api_wish を書いても、solution は通信なしで作れる形にする。思いつきで書かず、本当に効くものだけにする（なければ書かない）
- 次のような、今はまだない仕組みが要る案も出してよい。じっくり案件にして、needs に要るものを書く（作り始める前に止めて、人が仕組みを用意してから作る。何が要る案がどれだけ溜まるかで、次に作る仕組みを決める）: ${Object.entries(NEED_KINDS).map(([k, v]) => `${k}（${v.label}: ${v.hint}）`).join(" / ")}。needs を書いた案の solution は、その仕組みがある前提で書いてよい。仕組みがなくても作れる案には needs を書かない
アイデアごとに、ねらい（aim）を1つ決める。ねらいは、何をもって当たりとするかを決める。形（kind）はねらいから決まる（demand は lp、ほかは tool）。
- spread（${AIMS.spread.label}）: tool。見た人が思わず触り、結果やオチを人に見せたくなり、作った人の次の作品も見たくなるもの。遊び・診断・ネタ・おもちゃ・なりきり・見て楽しむものなど、形は自由（役に立たなくてよい）。30秒ほどで遊べて、何をするものかが1秒で伝わるものにする
- useful（${AIMS.useful.label}）: tool。困りごとを今すぐ解決する道具として、何度も使われるもの
- return（${AIMS.return.label}）: tool。毎日変わる理由（日替わりのお題・今日の1問・今日の運勢など）があり、明日もまた来たくなるもの。保存の領域は使えないので、日付から決まる日替わり（その日は全員に同じお題）で作る
- demand（${AIMS.demand.label}）: lp。まだ作らずに、紹介ページの事前登録で需要を確かめる
genre には、アイデアのジャンルを短い言葉で書く（例: ${GENRES.slice(0, 6).join("・")}）。
考える順番（ねらいごと）。形から発想しない:
- useful・demand: まず「誰の、どんな困りごとか」を決め、次に「その人に最初にどう届けるか」を決める
- spread: まず「1秒で分かって触りたくなる仕掛け」と「人に見せたくなる結果・オチ」を決め、次に「どんな投稿（短い動画の最初の1秒・結果の画像）で広がるか」を決める。target にはそれを面白がる人、problem には、その人のどんな気持ち（あるある・好奇心・見せたい気持ちなど）に刺さるかを書く（困りごとでなくてよい）
- return: まず「毎日変わる理由」と「明日も来たくなる仕組み」を決め、次に届け方を決める。problem には、毎日来る動機を書く
条件:
- 既にある案件が特定の時期や行事に偏っているときは、件数のうち1件以上はそれとは別の題材にする
- 医療・法律・金融など、規制が強い領域や専門資格が必要な領域は避ける（tool でも、診断の形で助言をしない）
- 誇大な約束はしない
- 実在の人物・団体のデータを使う tool は、正確なデータをコードに書けるものだけにする
- 季節もの（seasonal）を出すときは、話題が集まる日（例: 今年の漢字の発表日・年賀状を書き始める時期）を書き、そこから逆算した公開日と投稿の日程を channel に書く。first_test には、その日程で測る数値と判定の基準だけを書く（どちらも空欄にしない）
- 代わりになる既存の無料サービス（大手サイトの機能・汎用のAIチャットを含む）を名前で挙げ、それとの違いを alternative に書く。違いが言えない案は出さない（spread・return では、似た遊び・診断・ゲームとの違いを書く）
- spread・return の題材に、実在の人物や既存の作品（キャラクター・名前・決めぜりふ・見た目）を使わない。特定の作品の再現やパロディにしない。人をばかにする・いじるネタ、差別、性的なネタはしない
- 同じ「欲しい」の声（want_id）から複数の案を出すときは、形（lp と tool）か、対象者か、困りごとの切り口のどれかを必ず変える。同じ形・同じ切り口の言い換えを並べない
- 季節や世の中の話題に頼りすぎない。件数のうち半分以上（1件だけなら、その1件）は、季節や話題が過ぎても1年中ある困りごと（evergreen）にする。季節もの（seasonal）を出すなら、その季節が終わっても使われる理由があるものを選ぶ
- 時期のネタや世の中の話題は、使ってもよいヒントにすぎない（必ず使う材料ではない）。事件・事故・災害・訃報・個人の不祥事など、人の不幸や特定の個人に乗った企画はしない
- 最初の利用者にどう届くかも、一緒に考える。広告は使わず、フォロワーがほぼいないSNSアカウント（X・Threads・Bluesky への自動投稿ができる）と、運営者の手作業でできる範囲で。「SNSで宣伝する」のような曖昧な書き方ではなく、その対象者がすでに集まっている具体的な場所（検索される言葉・ハッシュタグ・コミュニティ・時期の話題など）と、そこでの見せ方を書く。他人の投稿やQ&Aサイトの質問に、宣伝のための返信・回答をする案や、知らない人へのDM・個別の勧誘は出さない（スパム扱いされやすいため）
- 自分の投稿だけ（フォロワーほぼ0では、ほとんど表示されない）にせず、運営者が手でできる直接の接点を最低1つ、数つきで channel に入れる（first_test には書かない）。例: 対象の人が集まるコミュニティ・グループの管理者に、紹介してよいか相談する（2か所）/ 対象に当てはまる知人に使ってもらい、感想を聞く（3人）/ ルールで紹介が認められている場（自己紹介・成果物の共有の場など）に1回だけ載せる
過去の教訓がある場合は必ず踏まえ、既にある案件と重複しないこと。教訓の確かさが「低」のものは仮説として扱い、それだけで題材や対象者を避けない。「最近出た案」と同じ題材・同じ困りごとの言い換えも出さない（別の対象者・別の困りごとを探す）。
形式: {"ideas":[{"aim":"spread・useful・return・demand のどれか","genre":"ジャンル（短い言葉）","kind":"lp または tool（aim から決まる）","title":"サービス名","target":"誰向けか（具体的に）","problem":"その人が困っていること・欲しいこと","solution":"どう解決するか（どんな種類のプロダクトか（Webサービス・スマホアプリなど）も書く。tool なら何ができるツールか。無料か有料か、登録が要るか要らないかも必ず書く）","hypothesis":"検証したい仮説（数字で判定できる形）","channel":"最初の利用者がいる具体的な場所と、そこでの届け方（運営者が手で行う直接の接点も、ここに数つきで書く）","first_test":"公開から最初の1週間の数値と判定の基準だけ（何人に届けて、何が起きれば手応えありとするか。届け方はここに書かない）","alternative":"代わりになる既存の無料サービスの名前と、それとの違い","season":"seasonal（その時期だけの需要）または evergreen（1年中ある需要）","reason":"このアイデアとこの形を選んだ理由","confidence":0から1の数値（反応がある見込み）,"want_id":元にした「欲しい」の声の番号（声から作ったときだけ。数値）,"deep":"じっくり案件にするときだけ: 何を作り込むか","deep_data":"じっくり案件で大きなデータが要るときだけ: 要るデータ","needs":[{"kind":"store・api・ai・asset・other のどれか（じっくり案件で、今はない仕組みが要るときだけ）","what":"何が要るか（短く）","why":"なぜ要るか"}],"api_wish":{"name":"使いたい API の名前（あるときだけ）","purpose":"何に使うか","key":true または false（鍵が要るか）,"sends":"訪問者のどんな情報を送ることになるか（送らないなら「なし」）"}}]}`,
    // 仮説の基準と、判断で使う目標がずれないように揃える
    user: `テーマ: ${theme || "おまかせ"}\n件数: ${count}${aims.length ? `\n今回のねらい（この順に1件ずつ出す）: ${aims.map((a, i) => `${i + 1}件目=${a}（${AIMS[a].label}）`).join("、")}` : ""}\nジャンル: ${genres.length ? `運営者が選んだもの（合うものがなければ、ないジャンルを使ってよい）: ${genres.join("・")}` : `おまかせ（最近の案件のジャンル: ${recentGenres.join("・") || "まだなし"}。同じジャンルが続かないようにする）`}${deepOnly ? "\n今回は運営者の依頼で、すべてをじっくり案件（kind は tool、deep に何を作り込むかを書く。大きなデータが要るときは deep_data も書く）で出すこと。ふつうの tool の制限では面白さが出ない題材を選ぶ" : ""}\n仮説の判定基準（形ごと。この基準を使うこと）:\n- lp: 訪問者の事前登録率 ${(s.targetSignupRate * 100).toFixed(1)}% 以上、訪問 ${s.judgeMinVisits}人で判定\n- tool: 訪問者のうち実際に使った人の割合 ${(s.targetUseRate * 100).toFixed(0)}% 以上、訪問 ${s.judgeMinVisits}人で判定（シェア数も参考にする）\n- spread は上の tool の基準に加えて、公開から3日の、遊んだ人の数とシェアの数も見る。return は、何日かあとにまた来た人がいるかも見る\n\n参考のヒント（使わなくてよい。季節もの以外のアイデアも半分以上出すこと）\n時期のネタ:\n${seasonalContext(new Date(), s.trendNotes)}\n\n${trendsText() || "（いまの話題はまだ取得していません）"}\n\n過去の教訓:\n${lessons}${hitsText()}\n\n既にある案件:\n${existing}\n\n最近出た案（選ばれなかったものも含む。同じ題材は出さない）:\n${recent}${viralHints("idea")}${wantsText()}${planIdeaNote()}\n\n${outsideText()}（アイデア出しでは、実際の人が何に困ったか・何に反応したかを、題材や届け方の参考にする）\n${researchText()}`,
    validate: (v): v is { ideas: Idea[] } => isObj(v) && Array.isArray(v.ideas) && v.ideas.length > 0 && v.ideas.every(isIdea),
  });
  // ねらいと形をそろえる。頼んだねらいにない案は候補にしない（運営者が絞ったねらい・配分を0にしたねらいの案件ができないように）
  const { ideas, dropped } = alignIdeaAims(out.ideas, aims);
  for (const d of dropped) {
    logEvent(null, "system", "idea-aim-skip", `${modelId ? modelInfo(modelId).label : "AI"}の案「${String(d.idea.title).slice(0, 60)}」は、頼んだねらい（${aims.map((a) => AIMS[a].label).join("・")}）にない、または件数を超えた「${AIMS[d.aim].label}」だったため、候補にしませんでした`);
  }
  return (deepOnly ? ideas.filter((x) => isDeepIdea(x) && x.kind === "tool") : ideas).slice(0, count);
}

function insertProject(idea: Idea, theme: string, choice: ModeChoice & { confidence: number | null }, origin: ProjectRow["origin"], ideaModel: string): number {
  const conf = typeof idea.confidence === "number" ? Math.max(0, Math.min(1, idea.confidence)) : null;
  const { mode } = choice;
  const id = Number(
    db()
      .prepare(
        `INSERT INTO projects (title, target, problem, solution, hypothesis, ai_reason, ai_confidence, stage, model_id, theme, mode, origin, idea_model, mode_confidence, kind, first_channel, first_test, want_id, deep, deep_need, deep_plan, aim, genre, needs)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'idea', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(idea.title, idea.target, idea.problem, idea.solution, idea.hypothesis, idea.reason, conf, getSettings().loopModel, theme || null, mode, origin, ideaModel, choice.confidence, idea.kind === "tool" ? "tool" : "lp",
        isStr(idea.channel) ? idea.channel.slice(0, 500) : null, isStr(idea.first_test) ? idea.first_test.slice(0, 500) : null,
        typeof idea.want_id === "number" && getWant(idea.want_id)?.status === "ok" ? idea.want_id : null,
        isDeepIdea(idea) ? 1 : 0, isDeepIdea(idea) && isStr(idea.deep_data) && idea.deep_data.trim() ? idea.deep_data.slice(0, 500) : null,
        isDeepIdea(idea) ? idea.deep!.slice(0, 500) : null, aimOfIdea(idea), isStr(idea.genre) ? idea.genre.trim().slice(0, 30) : null,
        isDeepIdea(idea) && needsOf(idea.needs).length ? JSON.stringify(needsOf(idea.needs)) : null)
      .lastInsertRowid,
  );
  logEvent(id, "ai", "idea", `アイデアを提案: ${idea.title}（${KIND_LABEL[idea.kind === "tool" ? "tool" : "lp"]}・${AIMS[aimOfIdea(idea)].label}${isStr(idea.genre) && idea.genre.trim() ? `・${idea.genre.trim().slice(0, 30)}` : ""}${isDeepIdea(idea) ? "・じっくり案件" : ""}・${MODE_LABEL[mode]}モード${choice.why === "設定" ? "" : `・${choice.why}`}）`);
  return id;
}

// 毎回承認ならアイデアの承認待ちへ、自動ならLPまで作って公開の承認待ちへ
// 大きなデータが要るじっくり案件は、どちらのモードでも、まずデータの下書きを作って人の確認に回す（データが要らないじっくり案件は、ふつうと同じ）
// decided: 人がすでに進めると決めた（人の作業待ちの「済み」など）。毎回承認の設定でも、アイデアの承認を挟まない
async function startProject(id: number, opts: { decided?: boolean } = {}) {
  const p = getProject(id)!;
  // まだない仕組み（保存の場所・API・AIなど）が要るじっくり案件は、人が用意して「済み」にするまで、作り始めない（人の作業待ち）
  const needs = p.deep && p.needs ? needsOf(JSON.parse(p.needs)) : [];
  if (needs.length && !p.needs_done) {
    logEvent(id, "system", "needs-wait", `作るのに要るもの（${needs.map((n) => `${NEED_KINDS[n.kind].label}: ${n.what}`).join(" / ")}）があるため、人の作業待ちにしました。用意できたら、案件の画面で「済み」にすると作り始めます`);
    return;
  }
  if (p.deep && p.deep_need) return prepareDeepData(id);
  if (p.mode === "manual" && !opts.decided) {
    addApproval(id, "idea", `「${p.title}」で進める`, p.ai_reason);
    return;
  }
  logEvent(id, "system", "auto", `自動モードのため、アイデアの承認を省いて${p.kind === "tool" ? "ツール" : "LP"}を作成`);
  await prepareLp(id, undefined, { auto: true });
}

// 集客中の案件の数。ねらいが「広がる」の案件は、ほかと別に数える（1日1本出して早めに判定するので、ほかの案件の枠を取り合わない）
// 育てる段階に入った案件は数えない（うまくいった案件があっても、新しいアイデアは止めない）
export function liveCounts(): { normal: number; spread: number } {
  const out = { normal: 0, spread: 0 };
  for (const r of db().prepare("SELECT CASE WHEN aim = 'spread' THEN 'spread' ELSE 'normal' END AS k, COUNT(*) AS n FROM projects WHERE stage = 'live' AND demo = 0 AND growth_phase = 0 GROUP BY k").all() as { k: "normal" | "spread"; n: number }[]) out[r.k] = r.n;
  return out;
}

// 今日（日本時間）作った「広がる」の案件の数（見送り・撤退したものも数える）
export function spreadMadeToday(): number {
  return (db().prepare("SELECT COUNT(*) AS n FROM projects WHERE demo = 0 AND aim = 'spread' AND date(created_at, '+9 hours') = ?").get(jstToday()) as { n: number }).n;
}

// ねらいごとの、新しい案件を作れない理由（作れるねらいは入らない）
// 「広がる」は、同時に集客中の上限と、毎日の自動アイデア出しのときだけ1日の上限を見る（人が頼んだときは1日の上限で止めない）。ほかのねらいは、集客中の上限
export function aimBlocks({ daily = false } = {}): Partial<Record<Aim, string>> {
  const s = getSettings();
  const c = liveCounts();
  const out: Partial<Record<Aim, string>> = {};
  if (c.normal >= s.maxLive) for (const a of AIM_KEYS) if (a !== "spread") out[a] = `集客中の案件（「広がる」以外）が${c.normal}件で、上限（${s.maxLive}件）に達しています`;
  if (c.spread >= s.spreadMaxLive) out.spread = `集客中の「広がる」の案件が${c.spread}件で、上限（${s.spreadMaxLive}件）に達しています`;
  else if (daily && spreadMadeToday() >= s.spreadPerDay) out.spread = s.spreadPerDay ? `今日の「広がる」の案件は、もう${s.spreadPerDay}件作りました` : "「広がる」の案件は、毎日の自動では作らない設定です";
  return out;
}

// 今回案件にしてよい「広がる」の件数（同時の上限まで。毎日の自動のときは、1日の上限まで）
export function spreadRoom({ daily = false } = {}): number {
  const s = getSettings();
  const byLive = Math.max(0, s.spreadMaxLive - liveCounts().spread);
  return daily ? Math.min(byLive, Math.max(0, s.spreadPerDay - spreadMadeToday())) : byLive;
}

// 会議のあと、案件を作る直前の確かめ直し。1件作るたびに呼び、作れないならその理由を返す（作れるなら null）
// 会議の間（1〜2分）にお休みの案件を集客に戻すなどして上限が変わることがあるので、会議の前の確かめだけに頼らない
// 「広がる」は、作ったばかりの案件（まだ集客中ではない）も数えるよう、確かめ直した時点の残りの件数を、作るたびに減らす
export function createGate({ daily = false } = {}): (aim: Aim) => string | null {
  let room = spreadRoom({ daily });
  return (aim) => {
    const late = aimBlocks({ daily })[aim] ?? (aim === "spread" && room <= 0 ? "今回作ってよい「広がる」の件数に達しています" : undefined);
    if (late) return late;
    if (aim === "spread") room--;
    return null;
  };
}

// 新しい案件を作れない理由（今月の予算で新しい案件を休む段階・集客中の上限）。作れるなら null
// aim を指定したらそのねらいだけを見る。指定しなければ、配分で出すねらい（重みのあるもの）がどれも作れないときだけ止める
export function newProjectBlock(aim?: Aim, opts: { daily?: boolean } = {}): string | null {
  const s = getSettings();
  const b = budgetState();
  if (!b.creativeOk) return `今月の予算の${Math.round((b.creativeCap / b.budget) * 100)}%を使い、新しい案件は休む段階です`;
  const blocks = aimBlocks(opts);
  if (aim) return blocks[aim] ?? null;
  const weights = aimWeightsOf(s);
  const used = AIM_KEYS.filter((a) => weights[a] > 0);
  const open = (used.length ? used : AIM_KEYS).filter((a) => !blocks[a]);
  return open.length ? null : [...new Set(Object.values(blocks))].join("。");
}

// 手動でアイデアを依頼したとき: 毎日の分と同じく、3社が案を出し、作者を伏せて採点し、上位の件数だけ案件にする
// 新しい案件を作れない間は、会議と採点だけ行い（会議の記録に残る。アイデアの質の確かめに使える）、案件にも敗者復活にもしない
// deep: 運営者が「じっくり案件だけ」を選んだとき。人が頼んだので、直近7日の上限が埋まっていても作る（作った分は上限に数える）
export async function generateIdeas(theme: string, count = 3, deep = false, aim?: Aim): Promise<{ ids: number[]; blocked: string | null }> {
  // じっくり案件はツールだけなので、需要を確かめる（事前登録LP）は選べない
  if (deep && aim && AIMS[aim].kind !== "tool") throw new Error("じっくり案件では、需要を確かめる（事前登録LP）は選べません");
  const title = `アイデア出し（${deep ? "じっくり案件・" : ""}${aim ? `${AIMS[aim].label}・` : ""}${theme ? `テーマ: ${theme.slice(0, 30)}` : "おまかせ"}）`;
  const blocked = newProjectBlock(aim);
  // ねらいを選ばなかったときは、いま作れないねらい（集客中の上限など）は出させない
  const exclude = aim ? [] : (Object.keys(aimBlocks()) as Aim[]);
  const { candidates, kept } = await withIdeaLock(title, () => gatherAndScoreIdeas(Math.max(2, count), blocked ? 0 : count, false, { title, theme, noRevival: !!blocked, deepOnly: deep, aim, exclude, spreadRoom: spreadRoom() }));
  if (!candidates.length) throw new Error("どのAIからもアイデアを得られませんでした");
  // 会議の間（1〜2分）に、ほかの処理で上限に達することもあるので、案件を作る直前にもう一度確かめる
  const blockedNow = blocked ?? newProjectBlock(aim);
  if (blockedNow) {
    logEvent(null, "ai", "idea-skipped", `アイデア会議の${candidates.length}件は、案件にしませんでした（${blockedNow}）`);
    return { ids: [], blocked: blockedNow };
  }
  const ids: number[] = [];
  const gate = createGate();
  for (const c of kept) {
    // 会議の間に、そのねらいの上限に達していたら作らない
    const late = gate(aimOfIdea(c.idea));
    if (late) {
      logEvent(null, "ai", "idea-skipped", `アイデア「${c.idea.title}」は、案件にしませんでした（${late}）`);
      continue;
    }
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
  return { ids, blocked: null };
}

// ---- じっくり案件のデータ ----

// データの下書きを作り、人の確認（判断待ち）に回す。comment: 人の修正指示（作り直すとき）
// 下書きに失敗したときも、案件を止めたままにせず、判断待ち（データの確認）に失敗の理由を出す。人は作り直す・自分でデータを入れる・見送るを選べる
async function prepareDeepData(projectId: number, comment?: string) {
  const p = getProject(projectId)!;
  const prev = db().prepare("SELECT spec FROM deep_data WHERE project_id = ? ORDER BY id DESC LIMIT 1").get(projectId) as { spec: string } | undefined;
  let drafted: { spec: DeepSpec; rows: DeepRow[] };
  try {
    drafted = await whileBuilding(projectId, "データを下書きしています", () => draftDeepData(p, comment, prev ? (JSON.parse(prev.spec) as DeepSpec) : undefined));
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 300);
    if (msg.startsWith("AIがいま")) throw e;
    logEvent(projectId, "system", "deep-data-error", `じっくり案件のデータの下書きに失敗: ${msg}`);
    addApproval(projectId, "data", `「${p.title}」のデータを作れませんでした`,
      `AIのデータの下書きに失敗しました（${msg}）。修正を指示すると作り直します。公式の表などがあれば、データを自分で入れることもできます。見送るなら却下してください。`,
      { error: msg });
    return;
  }
  const { spec, rows } = drafted;
  const dataId = Number(db().prepare("INSERT INTO deep_data (project_id, spec, rows) VALUES (?, ?, ?)").run(projectId, JSON.stringify(spec), JSON.stringify(rows)).lastInsertRowid);
  logEvent(projectId, "ai", "deep-data", `じっくり案件のデータを下書きしました（${rows.length}件・項目${spec.fields.length}個${comment ? "・指示を反映" : ""}）`);
  addApproval(projectId, "data", `「${p.title}」のデータ（${rows.length}件）を確かめる`,
    `${spec.note}。事実の項目（${spec.fields.filter((f) => f.kind === "fact").map((f) => f.label).join("・") || "なし"}）に誤りがないか、見立ての項目（${spec.fields.filter((f) => f.kind === "view").map((f) => f.label).join("・") || "なし"}）が誰かをおとしめていないかを見てください。承認すると、このデータでツールを作ります。`,
    { dataId });
}

// データの下書きの途中で止まったじっくり案件（承認したデータも判断待ちもなく、作業中でもない）を、もう一度下書きから始める
// 作成が途中で止まった案件（まだ公開しておらず、判断待ちがなく、作業中でもない）を、人が見送る。案件と記録（費用・経過・AIの入出力）は残す
export function abandonStuck(projectId: number, reason: string) {
  const p = getProject(projectId);
  const stuck = !!p && !buildingNow(p.id) && (p.stage === "idea" || (p.stage === "lp" && !p.lp))
    && !db().prepare("SELECT 1 FROM approvals WHERE project_id = ? AND status = 'pending'").get(p.id);
  if (!stuck) throw new Error("作成が止まった案件だけ、ここから見送れます");
  setStage(projectId, "rejected");
  const r = reason.trim().slice(0, 200);
  logEvent(projectId, "human", "abandon", `作成が止まった案件を見送りました${r ? `（${r}）` : ""}`);
}

export function deepDataStuck(p: Pick<ProjectRow, "id" | "deep" | "deep_need" | "stage">): boolean {
  return !!p.deep && !!p.deep_need && p.stage === "idea" && !buildingNow(p.id) && !approvedDeepData(p.id)
    && !db().prepare("SELECT 1 FROM approvals WHERE project_id = ? AND status = 'pending'").get(p.id);
}
export async function retryDeepData(projectId: number) {
  const p = getProject(projectId);
  if (!p || !deepDataStuck(p)) throw new Error("データの下書きをやり直せる状態ではありません");
  logEvent(projectId, "human", "deep-data-retry", "じっくり案件のデータの下書きを、やり直すよう指示しました");
  await prepareDeepData(projectId);
}

// ---- 人の作業待ち ----

// 要るものを人が用意した（仕組みを作った）ので、作り始める（データが要ればデータの下書き、なければ設計書を書いて開発待ちへ）
// 判断を待たずに返すよう、作り始める流れの Promise を返す（決まりに合わないときは、すぐ理由を返す）
export function markNeedsDone(projectId: number): Promise<void> {
  const p = getProject(projectId);
  if (!p || !p.needs || p.needs_done || p.stage !== "idea") throw new Error("人の作業待ちの案件ではありません");
  // まだない仕組み（保存の場所・API・AI）が要るものは、仕組みを作る（ツールの決まりも変える）までは「済み」にできない（作ってもツールから使えないため）
  const missing = notReady(needsOf(JSON.parse(p.needs)));
  if (missing.length) throw new Error(`まだない仕組み（${[...new Set(missing.map((n) => NEED_KINDS[n.kind].label))].join("・")}）が要るため、まだ「済み」にできません（その仕組みを作るときに、使えるようにします）`);
  db().prepare("UPDATE projects SET needs_done = 1, needs_done_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(projectId);
  logEvent(projectId, "human", "needs-done", "作るのに要るものを用意したので、作り始めます");
  // 人が「済み」で決めたので、毎回承認の設定でもアイデアの承認は挟まない。作り始めに失敗したら、人の作業待ちに戻す（宙に浮かせない）
  return startProject(projectId, { decided: true }).catch((e) => {
    db().prepare("UPDATE projects SET needs_done = 0, needs_done_at = NULL, updated_at = datetime('now') WHERE id = ?").run(projectId);
    // 失敗の詳しい内容は、来訪者には伏せる（種類に error を含めると伏せられる）
    logEvent(projectId, "system", "needs-error", `作り始めに失敗したため、人の作業待ちに戻しました（もう一度「済み」にできます）: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`);
    throw e;
  });
}

// ---- じっくり案件の開発（ここ = Claude Code で作る） ----
// じっくり案件のツールは込み入っていて、AIが1回で書くと長さの上限で途中で切れやすい（#60）。AIは設計書を書き、ツールは Claude Code で、
// ブラウザで確かめながら作る。できたHTMLを運営者が入れると、いつもどおりチェック・動作の確かめ・紹介ページ・公開の判断に進む

export const CLAUDE_CODE = "claude-code";
// 設計書の長さの上限（文字数）
export const DEV_DESIGN_MAX = 6000;

// 開発待ち（Claude Code で作るのを待っている）のじっくり案件の数
export function devWaiting(): number {
  return (db().prepare("SELECT COUNT(*) AS n FROM approvals a JOIN projects p ON p.id = a.project_id WHERE a.kind = 'dev' AND a.status = 'pending' AND p.demo = 0").get() as { n: number }).n;
}

// 前の設計書（いちばん新しい開発待ちのもの）
function lastDevDesign(projectId: number): string | null {
  const r = db().prepare("SELECT payload FROM approvals WHERE project_id = ? AND kind = 'dev' ORDER BY id DESC LIMIT 1").get(projectId) as { payload: string | null } | undefined;
  return r?.payload ? ((JSON.parse(r.payload) as { design?: string }).design ?? null) : null;
}

async function writeDevDesign(p: ProjectRow, comment?: string, prev?: string | null): Promise<string> {
  const out = await callJson<{ design: string }>({
    purpose: "じっくり案件の設計",
    projectId: p.id,
    system: `あなたは小さなWebツールの設計担当です。じっくり案件のツールの設計書を書きます。ツールは開発担当（Claude Code）が、この設計書をもとに、ブラウザで確かめながら作ります。
ツールは、紹介ページの中の枠に埋め込まれる1つのHTMLの断片で、外部との通信・保存の領域は使えません（作る側の決まりは別に渡します）。
設計書には、次の見出しで書く（Markdown。全体で${DEV_DESIGN_MAX.toLocaleString("en-US")}文字以内）:
## 一言で（何をするツールか。1〜2文）
## 画面（上から順に。スマホ幅360pxでの並び）
## 遊び方・使い方（操作の順番。最初の3秒で何をすればよいか分かること）
## 演出・手ざわり（動き・音・反応。どこに手をかけるか）
## 結果の見せ方とシェア（結果の画面・シェアの一文。結果の種類が決まっているなら、その名前の一覧）
## データ（使うデータとその使い方。要らなければ「なし」）
## 作り込むところ・やらないこと（時間をかける所と、今回は入れないもの）
## できたかの確かめ（動作の確かめの項目。5〜10個）
実在の人物・既存の作品を使わない。人をばかにするネタにしない。誇大な約束をしない。
出力はJSONのみ: {"design":"設計書（Markdown）"}`,
    user: `ツール名: ${p.title}\n対象: ${p.target}\n${p.aim === "spread" ? "刺さる気持ち" : "困りごと"}: ${p.problem}\n何ができるか: ${p.solution}\n作り込む所（じっくり案件）: ${p.deep_plan ?? "（なし）"}${p.deep_need ? `\n使うデータ: ${p.deep_need}` : ""}${prev ? `\n\n前の設計書:\n${prev}` : ""}${comment ? `\n\n運営者の指示（この指示に沿って設計書を直す）: ${comment}` : ""}`,
    validate: (v): v is { design: string } => isObj(v) && isStr(v.design) && v.design.trim().length > 0,
  });
  // 頼んだ長さ（6,000文字）を超えた分は切る（依頼文が長くなりすぎないように）
  return out.design.trim().slice(0, DEV_DESIGN_MAX);
}

// 開発待ちにする。最初に作るとき・設計を直す指示のときは、AIが設計書を書く（直すときは、前の設計書と直す指示を渡す）
// instruction: 公開した版を直すときの指示（改善・修正の指示）。comment: 運営者が設計書を直すよう指示したとき
async function requestDev(projectId: number, instruction?: string, comment?: string) {
  const p = getProject(projectId)!;
  const prev = lastDevDesign(projectId);
  const design = !prev || comment
    ? await whileBuilding(projectId, "ツールの設計書を書いています", () => writeDevDesign(p, comment, prev))
    : prev;
  const first = !p.lp;
  addApproval(
    projectId, "dev",
    first ? `「${p.title}」のツールを Claude Code で作る` : `「${p.title}」のツールを Claude Code で直す`,
    first
      ? "AIが設計書を書きました。依頼文を Claude Code に貼って作り、できたツールのHTMLをここから入れてください。入れると、いつもどおりチェック・動作の確かめ・紹介ページづくりをして、公開の判断待ちに出します。"
      : `次の指示で直します: ${instruction ?? comment ?? "（指示なし）"}。依頼文を Claude Code に貼って直し、できたHTMLをここから入れてください。入れるまでは、今の版のままです。`,
    { design, instruction: instruction ?? null },
  );
  logEvent(projectId, "ai", "dev-design", first || comment ? `じっくり案件のツールの設計書を書き、開発待ちにしました（Claude Code で作ります）${comment ? "・指示を反映" : ""}` : `じっくり案件のツールを直すため、開発待ちにしました（Claude Code で直します）: ${(instruction ?? "").slice(0, 120)}`);
}

// Claude Code に貼る依頼文（設計書・作るときの決まり・データ・入れ方）
export function devRequestText(projectId: number, design: string, instruction: string | null): string {
  const p = getProject(projectId)!;
  let rules = "";
  let dataNote = "なし（コードの中に書く）";
  try {
    const deep = deepContext(p);
    rules = toolRules(deep);
    if (deep?.data) dataNote = `window.labData（${deep.data.rows.length}件）。${deep.data.spec.note}。案件の画面の「データを保存」から JSON を取れます`;
  } catch (e) {
    rules = `（作るときの決まりを出せませんでした: ${e instanceof Error ? e.message : String(e)}）`;
  }
  return [
    `ai-lab の案件 #${p.id}「${p.title}」の、じっくり案件のツールを${p.lp ? "直して" : "作って"}ください。`,
    p.lp && instruction ? `直す指示: ${instruction}\n今のツールのHTMLは、案件の画面の「今のツールを保存」から取れます。` : "",
    `## 設計書\n${design}`,
    `## データ\n${dataNote}`,
    `## 作るときの決まり（AIが書くときと同じ。ただし Claude Code で作るときは、コードの長さは${TOOL_HTML_MAX.toLocaleString("en-US")}文字まで）\n${rules}`,
    `## できたら\n1つのHTMLの断片（<html><head><body> は書かない）・${TOOL_HTML_MAX.toLocaleString("en-US")}文字以内にして、スマホ幅でブラウザで動かして確かめてから、案件の判断待ちの「ツールのHTMLを入れる」から入れる。入れると、いつもどおりチェック・動作の確かめ・紹介ページ・公開の判断に進む。`,
  ].filter(Boolean).join("\n\n");
}

// ここで作ったツールのHTMLを入れる。決まり（外部との通信・保存の領域など）に合わないものは、すぐ理由を返す（入れない）
// 入れたら開発待ちを閉じ、いつもの流れ（チェック・動作の確かめ・紹介ページ・公開の判断）を始める（返すのは、その流れの Promise）
export function startDevUpload(approvalId: number, html: string): Promise<void> {
  const a = db().prepare("SELECT * FROM approvals WHERE id = ?").get(approvalId) as ApprovalRow | undefined;
  if (!a || a.kind !== "dev" || a.status !== "pending") throw new Error("ツールを入れられる開発待ちが見つかりません");
  const t = html.trim();
  if (!t) throw new Error("ツールのHTMLが空です");
  if (t.length > TOOL_HTML_MAX) throw new Error(`ツールのHTMLが長すぎます（${t.length.toLocaleString("en-US")}文字。${TOOL_HTML_MAX.toLocaleString("en-US")}文字まで）`);
  // Google Fonts の読み込みは、どのツールでも staticToolIssues の最初で外してから見る（じっくり案件でも使える）
  // 第2引数（deep）で変わるのは長さの上限だけ。Claude Code で作ったものは、上で TOOL_HTML_MAX（80,000文字）まで見たので、既定のままでよい
  const issues = staticToolIssues(t);
  if (issues.length) throw new Error(`決まりに合わないため入れられません: ${issues.join(" / ")}`);
  const p = getProject(a.project_id)!;
  db().prepare("UPDATE approvals SET status = 'approved', comment = ?, decided_at = datetime('now') WHERE id = ?").run("Claude Code で作ったツールを入れた", approvalId);
  logEvent(p.id, "human", "dev-upload", `Claude Code で作ったツール（${(t.length / 1000).toFixed(1)}千文字）を入れました`);
  const payload = JSON.parse(a.payload ?? "{}") as { design?: string; instruction?: string | null };
  const instruction = payload.instruction ?? undefined;
  // 取り込みの途中（紹介ページづくり・チェックなど）で失敗したら、開発待ちに戻す（同じHTMLをもう一度入れられるように。作り直しにはしない）
  return prepareLp(p.id, instruction, { toolHtml: t, keepCore: !!p.lp, auto: p.mode === "auto" && !p.public_slug }).catch((e) => {
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 200);
    addApproval(p.id, "dev", a.proposal, `入れたツールの取り込みに失敗しました（${msg}）。同じHTMLを、もう一度ここから入れてください。`, payload);
    throw e;
  });
}

// 人がデータを入れる（公式の表など、AIの下書きより正確なものがあるとき）。判断待ちのデータの確認を、入れたデータに差し替える
// 承認はまだしない（入れたデータも、表で確かめてから承認する）
export function uploadDeepData(approvalId: number, text: string): number {
  const a = db().prepare("SELECT * FROM approvals WHERE id = ?").get(approvalId) as ApprovalRow | undefined;
  if (!a || a.kind !== "data" || a.status !== "pending") throw new Error("データを入れられる確認待ちが見つかりません");
  const prevId = (JSON.parse(a.payload ?? "{}") as { dataId?: number }).dataId;
  const prev = prevId ? (db().prepare("SELECT spec FROM deep_data WHERE id = ?").get(prevId) as { spec: string } | undefined) : undefined;
  const prevSpec = prev ? (JSON.parse(prev.spec) as DeepSpec) : null;
  const { fields, rows } = parseUploadedData(text, prevSpec);
  const spec: DeepSpec = { fields, groups: [], per_group: "", note: `人が入れたデータ（${rows.length}件）${prevSpec ? `。項目はAIの設計に合わせた: ${prevSpec.note.slice(0, 200)}` : ""}` };
  const dataId = Number(db().prepare("INSERT INTO deep_data (project_id, spec, rows) VALUES (?, ?, ?)").run(a.project_id, JSON.stringify(spec), JSON.stringify(rows)).lastInsertRowid);
  if (prevId) db().prepare("UPDATE deep_data SET status = 'revised', comment = '人が入れたデータに差し替え' WHERE id = ?").run(prevId);
  db().prepare("UPDATE approvals SET payload = ?, proposal = ?, reason = ? WHERE id = ?").run(
    JSON.stringify({ dataId }), `「${getProject(a.project_id)?.title ?? ""}」のデータ（${rows.length}件・人が入れたもの）を確かめる`,
    "人が入れたデータです。表で見て問題がなければ承認してください。承認すると、このデータでツールを作ります。", approvalId);
  logEvent(a.project_id, "human", "deep-data-upload", `じっくり案件のデータを、人が入れたもの（${rows.length}件・項目${fields.length}個）に差し替えました`);
  return rows.length;
}

// 人が承認した、いちばん新しいデータ（じっくり案件のツールに渡す）
export function approvedDeepData(projectId: number): { spec: DeepSpec; rows: DeepRow[] } | null {
  const r = db().prepare("SELECT spec, rows FROM deep_data WHERE project_id = ? AND status = 'approved' ORDER BY id DESC LIMIT 1").get(projectId) as { spec: string; rows: string } | undefined;
  return r ? { spec: JSON.parse(r.spec) as DeepSpec, rows: JSON.parse(r.rows) as DeepRow[] } : null;
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
  // 自由に書いたページとツールのHTMLは長いので、文言の材料としては渡さない（書き返そうとして出力の上限で切れるため。ツールの修正は buildTool が担当）
  const prev = before ? `\n\n今のLP:\n${JSON.stringify({ ...before, page: undefined, tool: undefined, shareText: before.tool?.shareText })}` : "";
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
守ること:${isTool ? "" : "\n- まだ作ると決まっていないサービスで、このページは使いたい人がどれくらいいるかを確かめるためのもの。「開発中」「先行利用」「近日公開」「リリース予定」のように、作ることや提供の時期が決まっているかのようには書かない。「作るかどうかを決めるために、使ってみたい人を募っています」「提供することになったら、メールでお知らせします」のように、正直に書く\n- 見出し・サブ見出し・ボタンの文言・特徴・使い方の手順・使う前後の比較・よくある質問のどこでも同じ。できることを「〜になります」「〜します」「〜できます」と言い切らず、「〜を考えています」「〜を目指しています」「〜できるようにしたいと考えています」と書く（例: 「LINEで知らせます」→「LINEで知らせる形を考えています」、「1枚の画像にまとめます」→「1枚の画像にまとめることを目指しています」）"}
- 架空の利用者数・実績・お客様の声・受賞歴などは書かない
- 「必ず」「誰でも」などの誇大表現は使わない
- ターゲットが自分ごとだと感じる、具体的な言葉で書く
- ${isTool ? "ボタンの文言（cta）は、すぐ使えることが分かるもの（例「さっそく使ってみる」）。preview は不要。pains は使う人の動機（〜したい・〜が気になる）でもよい。完成例・例文・選択肢を書くなら、ツールで実際に選べるもの・出せる文だけにする（分からなければ書かない）" : "ボタンの文言（cta）は事前登録であることが分かるようにする"}${core}
見た目も対象読者に合わせて選ぶ（決まった部品の組み合わせで表示される。いつも同じ組み合わせにせず、このサービスらしさが出るものを選ぶ）:${direction ? `\n- 今回のデザインの方向性: ${direction}（これに合う組み合わせ・言葉づかいにする）` : ""}
- design.theme（テーマ色）: ${Object.entries(THEMES).map(([k, t]) => `${k}=${t.label}`).join(" / ")}
${(Object.keys(DESIGN_OPTIONS) as (keyof typeof DESIGN_OPTIONS)[]).map((k) => `- design.${k}: ${Object.entries(DESIGN_OPTIONS[k]).map(([v, l]) => `${v}=${l}`).join(" / ")}`).join("\n")}
- design.order: ${SECTIONS.join(" / ")} を、読んでほしい順に並べたもの（pains=困りごと, beforeAfter=使う前後, features=できること, steps=使い方, faq=よくある質問）
- design.badge: 見出しの上に出す短いラベル（15文字以内。例「飲食店のシフト集めに」）
- illustrationPrompt: 見出しの横に置くイラストを描くAIへの指示（英語で2〜3文）。サービスを使っている場面や、困りごとが解決した場面を、人物の顔をはっきり描かない形で。文字・ロゴ・実在の人物や商品は描かせない
- preview: 完成したら使う画面のイメージ。kind は ${PREVIEW_KINDS.join(" / ")} のどれか。rows は1行あたり最大4つの短い文字列で3〜5行（list は [項目, 状態]、table は columns と各行、chat は [話し手, 発言]、form は [項目名, 入力例]）。人名は「山田さん」程度の仮名にし、実在の会社名や効果の数字は入れない
- features[].icon: ${ICONS.join(" / ")} から内容に合うもの
- steps: 使い方を2〜4ステップ（任意）
- pains・features・faq・steps の数は中身に合わせて決める（pains 2〜4、features 2〜5、faq 0〜4、steps 2〜4）。いつも同じ数にそろえない。形式の例の数は、例にすぎない
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
// 前の版と比べるのは対象読者とサービスの中身だけ。ツール本体や自由に書いたページは、文章を確かめる側の版には入らないので渡さない
// （渡すと「前の版にあったツール本体がなくなった」と誤って報告する）
export const beforeForReview = (before: Lp): Lp => ({ ...before, tool: undefined, page: undefined });

// ツールの案件では、画面イメージ（preview）はページに出さずに捨てる。出ないものをチェックすると、
// 本物のツールと食い違うと誤って指摘して公開が止まるので、チェックの前に外す
export const toolPageForReview = (page: Lp): Lp => ({ ...page, preview: undefined });

// 公開前チェックの指示文。本番のチェックと、チェックの評価（checkEval.ts）で同じものを使う
export function lpReviewPrompt(p: Pick<ProjectRow, "kind" | "target" | "solution">, lp: Lp, before?: Lp, toolFacts?: string): { system: string; user: string } {
  return {
    system: `あなたはLPの公開前チェック担当です。次の点に1つでも当てはまれば ok を false にし、issues に具体的に書きます。
- 架空の利用者数・実績・お客様の声・受賞歴・具体的な効果の数字を断言している
- 「必ず」「誰でも」「100%」などの誇大表現がある${p.kind === "tool" ? "" : "\n- 「開発中」「先行利用」「近日公開」など、まだ作ると決まっていないのに、作ることや提供の時期が決まっているかのような書き方"}
${p.kind === "tool"
  ? "- ページの中のツールでできること以上のことを、できるかのように書いている\n- 見出し・例文・特徴・よくある質問に、ツールのコード（tool.html）にない選択肢や、ツールのテンプレートでは出ない例文を、ツールで作れるかのように載せている"
  : "- 開発前なのに、すぐ使えるかのように書いている"}
- 画面イメージ（preview）や使う前後の比較（beforeAfter）に、実在の会社名・個人を特定できる名前・効果の数字の断言が入っている
- 想定の対象読者からずれている${before ? "\n- 前の版から、対象読者やサービスの中身まで変わっている（改善は文言の調整にとどめるべき）" : ""}
問題がなければ {"ok":true,"issues":[]}。
形式: {"ok":true または false,"issues":["問題点"]}
${EXTRAS_RULE}`,
    user: `対象読者: ${p.target}\nサービスの中身: ${p.solution}${toolFacts ? `\n\nツールの中身（tool.html から取り出した、選択肢・入力欄の最初の値・画面に出る文言。${toolFacts.endsWith(TOOL_FACTS_CUT) ? "長いので途中までしか渡していない。ここにないからといって、ツールで作れないとは言い切らない" : "ここにない選択肢や例文は、ツールでは作れない"}）:\n${toolFacts}` : ""}\n\nチェックするLP:\n${JSON.stringify(lp)}${before ? `\n\n前の版:\n${JSON.stringify(beforeForReview(before))}` : ""}`,
  };
}

async function reviewLp(p: ProjectRow, lp: Lp, before?: Lp, toolHtml?: string): Promise<Review> {
  const out = await callJson<Review>({
    purpose: "LPチェック",
    projectId: p.id,
    ...lpReviewPrompt(p, lp, before, toolHtml ? toolFactsForReview(toolHtml) : undefined),
    validate: isReview,
  });
  takeExtras(out, { modelId: getSettings().loopModel, scene: "LPのチェック", projectId: p.id });
  return { ok: out.ok, issues: out.issues };
}

// LPのチェックに渡す、ツールの中身の抜き出し。コード全体は長く費用がかかるので、ページの文言と照らすのに要るものだけにする:
// 選択肢・入力欄の最初の値（開いた直後の状態）・ボタンや見出しの文言・スクリプトの中の日本語の文（テンプレートの例文など）
// （材料がないと、チェックが「ツールで出るか確かめられない」として止めていた）
export const TOOL_FACTS_CUT = "…（長いので途中まで）";
export function toolFactsForReview(html: string, max = 3000): string {
  const clean = (x: string) => x.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  const lines: string[] = [];
  // 選択肢は組（select）ごとに見る。selected がなければ、先頭（disabled でないもの）が最初に選ばれる
  const options = [...html.matchAll(/<select\b[^>]*>([\s\S]*?)<\/select>/gi)].flatMap((sel) => {
    const opts = [...sel[1].matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)].map((m) => { const a = tagAttrs(m[1]); return { text: clean(m[2]), selected: a.has("selected"), disabled: a.has("disabled") }; });
    const first = opts.some((o) => o.selected) ? -1 : opts.findIndex((o) => !o.disabled);
    return opts.map((o, i) => `${o.text}${o.selected || i === first ? "（最初に選ばれている）" : ""}`).filter(Boolean);
  });
  if (options.length) lines.push(`選択肢: ${[...new Set(options)].join(" / ")}`);
  const field = (a: Map<string, string>, type: string, value?: string) => {
    const name = a.get("aria-label") || a.get("name") || a.get("id") || "";
    const parts = [value !== undefined && value !== "" ? `最初の値 ${value}` : "", a.get("min") ? `最小 ${a.get("min")}` : "", a.get("max") ? `最大 ${a.get("max")}` : "", a.get("placeholder") ? `入力例 ${a.get("placeholder")}` : "", a.has("checked") ? "最初から選ばれている" : ""].filter(Boolean);
    return parts.length || type === "radio" || type === "checkbox" ? `${name || type}（${type}${parts.length ? `・${parts.join("・")}` : ""}）` : "";
  };
  const inputs = [
    ...[...html.matchAll(/<input\b([^>]*)>/gi)].map((m) => { const a = tagAttrs(m[1]); return field(a, a.get("type") || "text", a.get("value")); }),
    ...[...html.matchAll(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/gi)].map((m) => field(tagAttrs(m[1]), "textarea", m[2].trim())),
  ].filter(Boolean);
  if (inputs.length) lines.push(`入力欄: ${inputs.join(" / ")}`);
  const labels = [...html.matchAll(/<(button|label|h[1-6])\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((m) => clean(m[2])).filter(Boolean);
  if (labels.length) lines.push(`ボタン・見出し: ${[...new Set(labels)].join(" / ")}`);
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]).join("\n");
  const strings = scriptStrings(scripts).map((x) => x.replace(/\s+/g, " ").trim()).filter((x) => /[ぁ-んァ-ヶ一-龠]/.test(x));
  if (strings.length) lines.push(`スクリプトの中の文言: ${[...new Set(strings)].join(" / ")}`);
  const out = lines.join("\n");
  return out.length > max ? `${out.slice(0, Math.max(0, max - TOOL_FACTS_CUT.length))}${TOOL_FACTS_CUT}` : out;
}

// タグの属性を、名前ごとに読む（data-value や aria-checked を、value や checked と取り違えないように、名前が完全に同じものだけ）
function tagAttrs(src: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const a of src.matchAll(/([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+)))?/g)) {
    const name = a[1].toLowerCase();
    if (!m.has(name)) m.set(name, a[2] ?? a[3] ?? a[4] ?? "");
  }
  return m;
}

// スクリプトの中の文字列を、引用符の種類とエスケープを見ながら取り出す
// （コメントと正規表現リテラルは飛ばす。バッククォートの中は改行も含める）
function scriptStrings(js: string): string[] {
  const out: string[] = [];
  let prev = ""; // 直前の、空白でない文字（「/」が割り算か正規表現の始まりかを見分ける）
  for (let i = 0; i < js.length; i++) {
    const c = js[i];
    if (c === "/" && js[i + 1] === "/") { const n = js.indexOf("\n", i); i = n < 0 ? js.length : n; continue; }
    if (c === "/" && js[i + 1] === "*") { const n = js.indexOf("*/", i + 2); i = n < 0 ? js.length : n + 1; continue; }
    if (c === "/" && (prev === "" || "(,=:[!&|?{};+-*%<>~^".includes(prev) || /\b(return|typeof|case|in|of)$/.test(js.slice(Math.max(0, i - 7), i).trimEnd()))) {
      let j = i + 1;
      let inClass = false;
      for (; j < js.length && js[j] !== "\n"; j++) {
        if (js[j] === "\\") { j++; continue; }
        if (js[j] === "[") inClass = true;
        else if (js[j] === "]") inClass = false;
        else if (js[j] === "/" && !inClass) break;
      }
      i = j;
      prev = "/";
      continue;
    }
    if (c !== '"' && c !== "'" && c !== "`") { if (!/\s/.test(c)) prev = c; continue; }
    let j = i + 1;
    let text = "";
    for (; j < js.length && js[j] !== c; j++) {
      if (js[j] === "\\") { text += js[j + 1] ?? ""; j++; continue; }
      if (js[j] === "\n" && c !== "`") break; // 閉じていない
      text += js[j];
    }
    if (js[j] === c) out.push(text);
    i = j;
    prev = c;
  }
  return out;
}

// ---- 動くツールの本体 ----

// 隔離された枠の中では使えないもの・外部への通信など、コードを読めば分かる問題を先に見つける
// Google Fonts の読み込みだけは、どのツールでも外部のファイルとして数えない
// deep: じっくり案件のとき（コードの上限は TOOL_DEEP_CODE_MAX）
export function staticToolIssues(html: string, deep = false): string[] {
  const src = html.replace(/<link[^>]*\bhref\s*=\s*["']https:\/\/fonts\.googleapis\.com\/[^"']*["'][^>]*>/gi, "").replace(/@import\s+url\(\s*["']?https:\/\/fonts\.googleapis\.com\/[^)]*\)\s*;?/gi, "");
  const rules: [RegExp, string][] = [
    [/\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|navigator\.sendBeacon/, "外部と通信している（通信は遮断されるので動かない）"],
    [/<script[^>]*\bsrc\s*=|<link[^>]*\bhref\s*=|@import|url\(\s*['"]?https?:/i, "外部のファイルを読み込んでいる"],
    [/localStorage|sessionStorage|indexedDB|document\.cookie/, "保存領域や Cookie を使っている（隔離された枠では使えない）"],
    [/\b(alert|confirm|prompt)\s*\(|window\.open\s*\(/, "alert・confirm・prompt・window.open を使っている（隔離された枠では使えない）"],
    [/<form[^>]*\baction\s*=/i, "フォームをどこかに送信しようとしている"],
    [/<(html|head|body)[\s>]/i, "<html><head><body> を書いている（中身だけにする）"],
  ];
  const issues = rules.filter(([re]) => re.test(src)).map(([, msg]) => msg);
  const max = deep ? TOOL_DEEP_CODE_MAX : TOOL_HTML_MAX;
  if (html.length > max) issues.push(`長すぎる（${html.length}文字。${max}文字以内${deep ? "。データは window.labData のまま使い、コードに書き写さない" : ""}）`);
  if (!/<script[\s>]/i.test(html)) issues.push("スクリプトがなく、ツールとして動かない");
  if (hasResultsTag(html) && !toolResultsOf(html)) issues.push(`結果の一覧（lab-results）が決まりに合わない（<script type="application/json" id="lab-results"> の中に結果の名前の配列（JSON）を書き、1〜${TOOL_RESULTS_MAX}個・どれも空でなく前後に空白を付けず${TOOL_RESULT_LEN}文字以内にする。labResult の番号はこの並び順で数える）`);
  return issues;
}

// じっくり案件のツールで、ふつうのツールと違うところ（データは先に置かれている・Google Fonts を使える・見た目に手をかける）
// data: 人が確かめたデータ（大きなデータが要るじっくり案件だけ）
// 外への通信の決まり。フォントだけは、どのツールでも Google Fonts を使ってよい（CSP もその2か所だけ開ける）
const FONT_RULE = `- 外部のファイル・画像・API・CDN は使わない（通信は遮断される）。フォントだけは、Google Fonts を <link href="https://fonts.googleapis.com/css2?family=…&display=swap" rel="stylesheet"> で読み込んでよい（日本語が出るものを1〜2種類まで。ツールの雰囲気に合う書体を選び、読み込めなくても読める指定にする）`;
// このツールの紹介イラストは、ツールの中でも飾りに使ってよい（あとから描くので、ないときも崩れない作りにする）
const ASSET_RULE = `- window.labAssets.illustration に、このツールの紹介イラスト（横長の画像の URL）が入っていることがある。あれば <img> で見出しや結果の画面の飾りに使ってよい。ないとき・読み込めないときも崩れないようにする。canvas には描かない（結果の画像を保存できなくなる）`;

function deepToolNote(data: DeepData | null): string {
  return `${FONT_RULE}
${data ? `- データは、人が確かめた一覧が window.labData（配列。${data.rows.length}件）として先に置かれている。コードに書き写さず、window.labData を読んで使う。項目: ${data.spec.fields.map((f) => `${f.key}（${f.label}・${f.kind === "fact" ? "事実" : "遊びのための見立て"}）`).join(" / ")}
- 見立ての項目は、事実のように見せない（結果の画面に「遊びの見立てです」と分かる一言を入れる）
` : ""}- 見た目に手をかける: 色・余白・文字の大きさ・動き（CSS のアニメーション）を工夫し、結果の画面を、人に見せたくなる・記憶に残るものにする。効果音を使うなら Web Audio API で作り（ファイルは使えない）、最初は鳴らさず、押したときだけ鳴らす
- コードは全体で${TOOL_DEEP_CODE_MAX.toLocaleString("en-US")}文字以内${data ? "（データは含めない）" : ""}。読みやすく、動作の確かなコードにする`;
}
type DeepData = { spec: DeepSpec; rows: DeepRow[] };

// ツールを書くときの決まり（作るときと、じっくり案件の見た目を磨くときで共通）
// deep: じっくり案件か（data は、大きなデータが要るときだけ）
function toolRules(deep: { data: DeepData | null } | null): string {
  return `守ること:
- 1つのHTMLの断片だけを書く（<style> と <script> を含めてよい。<html><head><body> は書かない）
${deep ? deepToolNote(deep.data) : `${FONT_RULE}。必要なデータはコードの中に書く`}
${ASSET_RULE}
- localStorage・sessionStorage・Cookie・IndexedDB・alert・confirm・prompt・window.open は使えない（エラーになる）。別のページを開くリンクも動かない
- 結果を画像としてダウンロードさせることと、文をクリップボードにコピーすることはできる
- フォームは送信しない（ボタンは type="button"）。入力は端末の中だけで処理する
- 名前・メールアドレスなど個人を特定できる情報は入力させない
- スマホ幅（360px）でも崩れない。prefers-color-scheme でライト・ダークの両方で読めるようにする
- 日本語。開いた瞬間に使い方が分かるようにする。入力欄は空にし、入力例は placeholder で見せる（入力例の値で、結果を最初から出しておかない。結果は利用者が入力・選択・ボタンを押したときにすぐ表示する）。すぐ試したい人のために「例で試す」ボタンを置いてもよい
- 結果は、シェアしたくなる見せ方を工夫する。結果が出るたびに、その結果を伝える短い一文（60文字くらい。個人を特定できる内容は入れない）を作り、window.labShare && window.labShare("その一文") を呼ぶ（ページのシェアのボタンの文に使われる）
- 結果の種類が決まっているツール（診断・タイプ分け・くじなど）は、<script type="application/json" id="lab-results">["結果の名前", …]</script> に結果の名前をすべて書き（${TOOL_RESULTS_MAX}個まで・1つ${TOOL_RESULT_LEN}文字まで・短く印象に残る名前）、結果を出すたびに window.labResult && window.labResult(その結果の番号。0から) を呼ぶ（シェアされたリンクに、その結果の名前を大きく出した画像が付く）。数の計算など、結果が決まった種類でないツールは書かない
- 架空の統計を事実のように書かない。診断・占いのような遊びのツールは、そうと分かる一言を入れる。医療・法律・お金の助言はしない
- 実在の人物・団体のデータは、正確だと確信できるものだけを使う。不確かなら使わない
- 入力欄の上限・下限（min・max）と、エラー文・注意書き・説明の中の数字（「300cm以下」など）を同じ値にする。上限を変えるときは、その数字を書いた所もすべて直す${deep ? "" : "\n- 全体で40,000文字以内。データの一覧は代表的なものに絞り、何百件も書き連ねない。読みやすく、動作の確かなコードにする"}
- 「何ができるツールか」や修正指示で、コードに書かない・利用者が自分で入れると決めた値（手数料率・料金など）は、初期値・プリセット・選択肢・入力例・便利な機能の形でも書かない。ただし「例で試す」のボタンで、例だと分かるように示した値（例: 「東京の緯度 35.7」）をまとめて入れ、すぐ結果を見せるのはよい。料金・手数料率など、使う人ごとに違い、間違えると損をする値は、例のボタンでも入れない
- canvas で角丸の四角形・幅に収める文字・折り返しを描くときは、自分で書かずに次の確かめ済みの関数をそのまま貼って使う（中身は変えない）:
\`\`\`js
${CANVAS_HELPERS_JS}
\`\`\`
`;
}

// 人が確かめたデータの例（じっくり案件のツールを書く・磨くAIに、データの形を見せる）
const deepDataText = (deep: DeepData) =>
  `\n\nwindow.labData の説明: ${deep.spec.note}\nwindow.labData の例（全${deep.rows.length}件のうち、等間隔に15件）:\n${JSON.stringify(sampleRows(deep.rows, 15))}`;

// じっくり案件か（ふつうの案件なら null）。大きなデータが要る案件は、人が承認したデータも返す（まだなければ作れない）
function deepContext(p: ProjectRow): { data: DeepData | null } | null {
  if (!p.deep) return null;
  if (!p.deep_need) return { data: null };
  const data = approvedDeepData(p.id);
  if (!data) throw new Error("大きなデータを使うじっくり案件ですが、人が承認したデータがありません");
  return { data };
}
// じっくり案件で、何を作り込むか（アイデアに書かれたもの）とデータの例を、ツールを書く・磨くAIに渡す
const deepText = (p: ProjectRow, deep: { data: DeepData | null }) =>
  `${p.deep_plan ? `\n作り込む所（じっくり案件）: ${p.deep_plan}` : ""}${deep.data ? deepDataText(deep.data) : ""}`;

export async function writeToolHtml(p: ProjectRow, instruction?: string, prevHtml?: string, modelId?: string, effort?: "medium"): Promise<string> {
  const deep = deepContext(p);
  const system = `あなたは小さなWebツールを作るフロントエンドエンジニアです。紹介ページの中の枠に埋め込まれる、ツール本体を1つ書きます。
${toolRules(deep)}`;
  const user = `ツール名: ${p.title}\n対象: ${p.target}\n使う人の動機・困りごと: ${p.problem}\n何ができるツールか: ${p.solution}${deep ? deepText(p, deep) : ""}${prevHtml ? `\n\n今のツール:\n${prevHtml}` : viralHints("tool")}${instruction ? `\n\n今回の修正指示: ${instruction}` : ""}`;
  // ツールのHTMLは長く、JSONに包むと出力の上限で途中で切れやすい。HTMLをそのまま最後まで受け取る
  const author = modelId ?? claudeModelId();
  if (author) {
    const text = await callLong({
      modelId: author,
      purpose: "ツール作成",
      projectId: p.id,
      system: `${system}出力はHTMLの断片だけ。説明やコードブロックは付けない。`,
      user,
      // ふつうは多くても4万トークン弱。暴走したときの無駄を減らすため、少しだけ余裕を見た上限にする
      maxTokens: 48000,
      effort,
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
// instruction: 今回の修正指示（作るときと同じ「コードに書かない値」を、チェックでも確かめられるように渡す）
async function reviewTool(p: ProjectRow, html: string, instruction?: string): Promise<Review> {
  const out = await callJson<Review>({
    purpose: "ツールチェック",
    projectId: p.id,
    system: `あなたはWebツールの公開前チェック担当です。コードを読んで、次の点に1つでも当てはまれば ok を false にし、issues に具体的に書きます。
- 文法の誤りや、ボタンを押しても何も起きない・結果が出ないなど、動かない箇所がある
- 外部への通信、外部ファイルの読み込み、保存領域・Cookie・alert・window.open を使っている（Google Fonts の読み込みと、window.labAssets のイラストを <img> で出すことは問題にしない）${p.deep ? `（このツールはじっくり案件${p.deep_need ? "。先に置かれた window.labData を読むことも問題にしない。window.labData の中身をコードに書き写していたら問題にする）\n- 遊びのための見立てのデータを、事実のように見せている" : "）"}` : ""}
- 個人を特定できる情報を入力させている
- 架空の統計を事実のように書いている、医療・法律・お金の助言をしている、誰かを傷つける・差別的な内容がある
- 実在の人物・団体について、不正確そうなデータを使っている
- 「${p.solution}」というツールの目的からずれている
- ツールの目的や今回の修正指示で、コードに書かない・利用者が自分で入れると決めた値（手数料率・料金など）を、初期値・プリセット・選択肢・入力例・便利な機能などの形でコードに書いている（「例で試す」のボタンで、例だと分かるように示した値をまとめて入れるのは問題にしない。ただし料金・手数料率など、使う人ごとに違い、間違えると損をする値を例のボタンで入れていたら問題にする）
- canvas などで画像を作るとき、入力できる最大の文字数でも、本文とロゴ・ハッシュタグなどが重ならない作りになっていない（本文を描く範囲の下端が決まっていない）
- 入力欄の上限・下限（min・max）と、エラー文・注意書き・説明の中の数字が食い違っている（max が 600 なのにエラー文が「300cm以下」など）
- 「最小です」「ゼロにできます」のように理論上のことを言い切る表示が、小さな条件（人数が少ない・値が0や1など）で実際に手計算すると成り立たない
- 使う前と後・改善前と後などの比較を出すとき、利用者が条件を変えても、比較の基準（前の値）が同じ条件で計算されていない（条件によって改善率がマイナスになる・表示が崩れる など）
問題がなければ {"ok":true,"issues":[]}。
形式: {"ok":true または false,"issues":["問題点"]}
${EXTRAS_RULE}`,
    user: instruction ? `今回の修正指示: ${instruction}\n\nツールのコード:\n${html}` : html,
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

// じっくり案件の、できたツールの見た目を磨く（機能・データの読み方は変えない）。スマホ幅で撮った画面を見せて、Claude が直す
// 磨いた版がチェックを通らなければ、磨く前の版を使う（呼び出し側で確かめる）
async function polishTool(p: ProjectRow, html: string, deep: { data: DeepData | null }, shot: string | undefined): Promise<string | null> {
  const model = claudeModelId();
  const file = shot ? screenshotPath(shot) : null;
  if (!model || !file) return null;
  const text = await callClaude({
    purpose: "ツールの見た目を磨く",
    projectId: p.id,
    modelId: model,
    maxTokens: 48000,
    system: `あなたはWebツールの見た目を仕上げるデザインエンジニアです。動いているツールのコードと、スマホ幅（375px）で操作したあとの画面を見て、見た目だけを磨きます。
- 機能・計算・${deep.data ? "window.labData の読み方・" : ""}ボタンの動き・window.labShare の呼び出しは変えない
- 色・余白・文字の大きさと太さ・並び・結果の画面の見せ方・動き（CSS のアニメーション）を整え、結果を人に見せたくなる仕上がりにする
- 画面で読みにくい所・詰まって見える所・はみ出しそうな所を直す
${toolRules(deep)}
出力は、磨いたあとのHTMLの断片だけ。説明やコードブロックは付けない。`,
    content: [
      { type: "image", source: { type: "base64", media_type: "image/png", data: fs.readFileSync(file).toString("base64") } },
      { type: "text", text: `ツール名: ${p.title}\n対象: ${p.target}${deepText(p, deep)}\n\n今のツールのコード:\n${html}` },
    ],
  });
  return text.replace(/^\s*```(?:html)?\s*/i, "").replace(/```\s*$/, "").trim();
}

// given: ここ（Claude Code）で作ったツールのHTML。あれば、AIは書かずに、チェックと動作の確かめだけをする（書き直し・見た目を磨く段は通さない）
async function buildTool(p: ProjectRow, shotName: string, instruction?: string, prevHtml?: string, given?: string): Promise<{ html: string; review: Review; test: ToolTest; model: string; rewrites: number; deep: { data?: DeepRow[]; fonts: true } | null }> {
  let model = given !== undefined ? CLAUDE_CODE : toolModelFor(p);
  const deep = deepContext(p);
  const frame = deep ? { data: deep.data?.rows, fonts: true as const } : { fonts: true as const };
  // 長すぎて最後まで書けなかったら、別の会社のAIに規模を絞って書き直してもらう（同じAIで繰り返すと、同じ所で切れやすい）
  const write = async (note?: string, base?: string): Promise<string> => {
    try {
      return await writeToolHtml(p, note, base, model);
    } catch (e) {
      const next = TOOL_MODELS.find((id) => id !== model && hasKey(modelInfo(id).provider));
      if (!next || !(e instanceof Error) || !e.message.includes("途中で切れました")) throw e;
      logEvent(p.id, "system", "tool-retry", `${modelLabel(model)}のツール作成が長くなりすぎて途中で切れたため、${modelLabel(next)}に規模を絞って書き直してもらいます`);
      model = next;
      const shrink = deep
        ? `前回は長くなりすぎて最後まで書けなかった。${deep.data ? "データは window.labData のまま使い、" : ""}機能は中心の1つに絞って、コードを40,000文字以内で最後まで書き切ること`
        : "前回は長くなりすぎて最後まで書けなかった。機能は中心の1つに絞り、データは代表的なものだけにして、全体を25,000文字以内で最後まで書き切ること";
      return writeToolHtml(p, note ? `${note} / ${shrink}` : shrink, base, model, "medium");
    }
  };
  const check = async (h: string): Promise<{ review: Review; test: ToolTest }> => {
    const [ai, test] = await Promise.all([reviewTool(p, h, instruction), testTool(h, shotName, frame)]);
    // Claude Code で作ったツールは、長さの上限をふつうのツールと同じ（80,000文字）にする（AIが1回で書くときだけ、じっくり案件はコードを短めにさせる）
    const issues = [...staticToolIssues(h, !!deep && given === undefined), ...ai.issues, ...testIssues(test)];
    return { review: { ok: issues.length === 0 && ai.ok, issues }, test };
  };
  if (given !== undefined) {
    // 人とここで確かめながら作ったものなので、AIは書き直さない。チェックで残った指摘は、公開の判断待ちに出す（直すなら、また開発待ちにする）
    const r0 = await check(given);
    if (!r0.review.ok) logEvent(p.id, "ai", "review", `Claude Code で作ったツールのチェックで指摘があります（公開の判断待ちに出します）: ${r0.review.issues.join(" / ").slice(0, 300)}`);
    return { html: given, ...r0, model, rewrites: 0, deep: deep ? { ...(deep.data ? { data: deep.data.rows } : {}), fonts: true } : null };
  }
  let html = await write(instruction, prevHtml);
  let r = await check(html);
  let rewrites = 0;
  if (!r.review.ok) {
    logEvent(p.id, "ai", "review", `ツールのチェックで問題が見つかったため書き直し: ${r.review.issues.join(" / ")}`);
    html = await write(`次の問題を直すこと: ${r.review.issues.join(" / ")}`, html);
    r = await check(html);
    rewrites = 1;
  }
  // じっくり案件の新しいツールは、チェックを通ったら見た目を磨く段を1回通す（直しの指示で作り直すときは、指示以外を変えないので通さない）
  if (deep && !prevHtml && r.review.ok) {
    const polished = await polishTool(p, html, deep, r.test.screenshot).catch((e) => {
      logEvent(p.id, "system", "tool-polish", `見た目を磨く段に失敗したため、磨く前の版を使います: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`);
      return null;
    });
    if (polished) {
      const r2 = await check(polished);
      if (r2.review.ok) {
        html = polished;
        r = r2;
        logEvent(p.id, "ai", "tool-polish", "見た目を磨きました（チェックも通過）");
      } else {
        // 磨いた版で見つかった指摘は、磨く前の版にも当てはまることがある（#59 では、時刻の範囲が固定されている不具合が両方にあった）
        // 磨く前の版にその指摘を渡して1回直させる。直した版がチェックを通ればそれを使う
        logEvent(p.id, "system", "tool-polish", `磨いた版がチェックを通らなかったため、磨く前の版に同じ指摘を渡して直させます: ${r2.review.issues.join(" / ").slice(0, 300)}`);
        const fixed = await write(`見た目を磨いた版のチェックで、次の問題が見つかった。今のコードにも当てはまるものだけを直すこと（当てはまらないものには何もしない。見た目と、ほかの機能は今のまま）: ${r2.review.issues.join(" / ")}`, html).catch((e) => {
          logEvent(p.id, "system", "tool-polish", `磨く前の版の直しに失敗しました: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`);
          return null;
        });
        // 直した版のチェック自体が失敗したとき（AIの呼び出しの失敗など）も、止めずに下の「直せなかったとき」に回す
        const r3 = fixed ? await check(fixed).catch((e) => {
          logEvent(p.id, "system", "tool-polish", `直した版のチェックに失敗しました: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`);
          return null;
        }) : null;
        if (fixed && r3?.review.ok) {
          html = fixed;
          r = r3;
          rewrites++;
          logEvent(p.id, "ai", "tool-polish", "磨いた版で見つかった問題を、磨く前の版で直しました（チェックも通過）");
        } else {
          // 直せなかったときは磨く前の版を使うが、指摘は残して人の確認に回す（磨く前の版にも当てはまるかもしれないため、全自動で公開しない）
          r = { ...r, review: { ok: false, issues: [...r.review.issues, ...r2.review.issues.map((x) => `磨いた版のチェックで見つかった指摘（磨く前の版にも当てはまるか確かめてください）: ${x}`)] } };
          logEvent(p.id, "system", "tool-polish", "磨いた版で見つかった問題を直しきれなかったため、磨く前の版を使い、指摘を判断待ちに出します");
        }
      }
    }
  }
  return { html, ...r, model, rewrites, deep: deep ? { ...(deep.data ? { data: deep.data.rows } : {}), fonts: true } : null };
}

// 今の版のツールを、もう一度ブラウザで自動テストする（案件の画面のボタンから）
export async function retestTool(projectId: number): Promise<ToolTest> {
  const p = getProject(projectId);
  const tool = p?.lp ? (JSON.parse(p.lp) as Lp).tool : undefined;
  if (!p || !tool) throw new Error("動くツールの案件ではありません");
  const test = await testTool(tool.html, `p${p.id}-v${p.lp_version}`, { data: tool.data, fonts: tool.fonts });
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
async function buildLpVersion(projectId: number, opts: { instruction?: string; note: string; keepCore?: boolean; toolHtml?: string }) {
  const kind = getProject(projectId)!.kind;
  const what = `${kind === "tool" ? "ツール" : "LP"}を${opts.instruction || opts.keepCore ? "直して" : "作って"}います`;
  return whileBuilding(projectId, what, () => buildLpVersionNow(projectId, opts));
}

async function buildLpVersionNow(projectId: number, opts: { instruction?: string; note: string; keepCore?: boolean; toolHtml?: string }) {
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

// ツールの版を作るとき、まわりのページをAIに自由にデザインさせるか
// 新しく作るツール（前の版にツールがない）と、すでに自由なページを持つツールだけ。部品のページで公開中のツールは部品のまま
export const shouldDesignToolPage = (freePage: boolean, before: Lp | null | undefined) => freePage && (!before?.tool || !!before.page);

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

async function buildToolVersion(p: ProjectRow, before: Lp | undefined, opts: { instruction?: string; note: string; keepCore?: boolean; toolHtml?: string }) {
  const { shareText, ...page } = await writeLp(p, opts.instruction, opts.keepCore);
  const version = nextVersion(p.id);
  const tool = await buildTool(p, `p${p.id}-v${version}`, opts.instruction, before?.tool?.html, opts.toolHtml);
  const pageReview = await reviewLp(p, toolPageForReview(page), opts.keepCore ? before : undefined, tool.html);
  let review: Review = { ok: tool.review.ok && pageReview.ok, issues: [...tool.review.issues, ...pageReview.issues] };
  let lp: Lp = normalizeLp({ ...page, preview: undefined, tool: { html: tool.html, shareText: shareText ?? before?.tool?.shareText ?? page.headline, fonts: true, results: toolResultsOf(tool.html), ...(tool.deep ?? {}) } });
  if (!lp.tool) throw new Error("ツールが大きすぎるか空のため保存できませんでした");
  if (tool.deep?.data && !lp.tool.data) throw new Error("じっくり案件のデータが大きすぎるため保存できませんでした");
  if (lp.design) lp.design.illustration = before?.design?.illustration;
  const drawn = await withIllustration(p, lp, version);
  lp = drawn.lp;
  if (drawn.note) logEvent(p.id, "system", "illustration", drawn.note);
  // ツールのまわりのページも、AIが自由にデザインする（上の短い見出し → ツール → 下の説明）
  // 新しく作るツール（前の版にツールがない。事前登録のページからツールにするときも）と、すでに自由なページを持つツールだけ
  // 部品のページで公開中のツールは、作り直しても部品のまま（見た目を急に変えない）
  // 今のページを直すのは、前の版が自由なページのツールのときだけ（事前登録のページは登録フォームがあり、ツールのページとして直せないので、新しく作る）
  const toolPage = before?.tool ? before.page : undefined;
  if (shouldDesignToolPage(getSettings().freePage, before)) {
    const made = await withPage(p, lp, version, { prevHtml: toolPage?.html, instruction: opts.instruction, keepCore: opts.keepCore });
    lp = made.lp;
    if (made.check && !made.check.ok) review = { ok: false, issues: [...review.issues, ...made.check.issues.map((x) => `デザイン: ${x}`)] };
  }
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

export async function prepareLp(projectId: number, instruction?: string, opts: { keepCore?: boolean; byHuman?: boolean; auto?: boolean; toolHtml?: string } = {}) {
  const p = getProject(projectId)!;
  // じっくり案件のツールは、AIが1回で書かずに、ここ（Claude Code）で作る・直す。AIは設計書を書き、開発待ちにする
  if (p.kind === "tool" && p.deep && opts.toolHtml === undefined) return requestDev(projectId, instruction);
  const note = !instruction ? "最初の版" : opts.byHuman ? `あなたの指示: ${instruction}` : `指示: ${instruction}`;
  const { lp, review } = await buildLpVersion(projectId, { instruction, note: opts.toolHtml !== undefined ? `${note}（ツールは Claude Code で作った）` : note, keepCore: opts.keepCore, toolHtml: opts.toolHtml });
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
// spread = ねらいが「広がる」の案件が、決めた日数で当たりの基準を超えた（当たらなかった案件は判断せずに集客をお休みにする）
export type JudgeTrigger = "visits" | "budget" | "slow" | "spread";

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
    ? `\n今回は、公開（または前回の判断）から${s.judgeAfterDays}日たっても訪問が少ないので判断する。訪問が少ないことは「需要がない」とは限らず、「届いていない」だけかもしれない。投稿の数・反応も見て、まず届け方の問題（rethink）か、届いているのに反応がない（kill・improve）かを見分けること。訪問が判断の基準（${s.judgeMinVisits}人）に届いていない間の kill は、自動では実行されず人の判断に回る。最初の届け方をまだやっていない（または見送った）なら、需要の問題ではなく届け方の問題として扱い、それを理由に書くこと。${p.rethink_count >= 2 ? `\nこの案件はすでに集客の見直しを${p.rethink_count}回している。これ以上 rethink は選ばず、kill か improve か collect から選ぶこと。` : ""}`
    : "";
  const spreadNote = trigger === "spread"
    ? `\n今回は、ねらいが「広がる」（遊び・ネタで、見た人が触ってシェアし、フォロワーが増える）の案件が、公開（または前回の判断）から${s.spreadJudgeDays}日で、当たりの基準（遊んだ人${s.spreadHitPlays}人以上か、シェア${s.spreadHitShares}件以上）を超えたので判断する。広がっているので kill は選ばない。役に立つかではなく、もっと遊ばれ・シェアされるか（結果を見せたくなる工夫・次も遊びたくなる工夫）で考える。`
    : "";
  return {
    all,
    system: `あなたは事業の撤退判断を担当するアナリストです。${isTool ? "対象は、紹介ページの中ですぐ使える「動くツール」です。" : ""}集客の数字を見て、判断します。${spreadNote}
${options}
${budgetRule(s)}
数字が少なすぎて判断できない場合も、その旨を理由に書いたうえで最も妥当なものを選ぶこと。
improve は「今すぐ変える」場合だけに使う。「もう少し様子を見てから変える」なら collect を選ぶこと。
「ページの中での動き」があれば、どこで離脱しているか（読まれていない・ボタンが押されない・入力したのに登録しない など）を理由と next_action に活かすこと。
improve の場合、next_action には「どこを、どう変えるか」を1か所だけ、条件を付けずに具体的に書くこと（一度に複数を変えると、何が効いたか分からなくなるため）。
rethink の場合、next_action には「どこで（具体的な場所・ハッシュタグ・検索される言葉）、誰に、どんな切り口で届けるか」を具体的に書くこと。これまでの届け方と同じことは書かない。自動で投稿できるのは X・Threads・Bluesky の自分の投稿だけで、それ以外の場所は運営者の手作業になるので、自分の投稿の切り口を中心にする。他人の投稿やQ&Aサイトに宣伝のための返信・回答をする案は出さない。${slowNote}
外の声（実際の人の反応）があれば、数字と同じかそれ以上に重く見る。外の声や調べたことを根拠に判断や next_action を変えたら、voice_effects に声の番号（voice_ids）・調べものの番号（research_ids）と、何をどう変えたかを書く（なければ空の配列）。
形式: {"decision":"${growing ? "improve|rethink|collect|kill" : "continue|improve|collect|rethink|kill"}","reason":"判断理由（数字を引用）","confidence":0から1,"next_action":"次にやること","voice_effects":[{"voice_ids":[声の番号],"research_ids":[調べものの番号],"change":"何をどう変えたか"}]}`,
    user: `サービス: ${p.title}（対象: ${p.target}）
仮説: ${p.hypothesis}
企画のときに決めた最初の届け方: ${p.first_channel ?? "（なし）"}
最初の届け方の実施（運営者の手作業）: ${firstChannelLabel(firstChannelState(p.id))}
企画のときに決めた最初の1週間の検証: ${p.first_test ?? "（なし）"}
${p.growth_focus ? `いまの集客の方針（前回の見直しで決めたもの）: ${p.growth_focus}\n` : ""}公開してから: ${p.published_at ? `${Math.floor(daysSinceUtc(p.published_at))}日` : "不明"}${p.judged_at ? ` / 前回の判断から ${Math.floor(daysSinceUtc(p.judged_at))}日` : ""} / 集客の見直し ${p.rethink_count}回${growing ? ` / 育てる段階での実験 ${p.growth_count}回` : ""}
SNSへの投稿: ${posts}${split}
今の${isTool ? "版" : "LP"}（第${p.lp_version}版）での結果: 訪問 ${cur.visits}人 / ${c.noun} ${cur.signups}人 / ${c.rate} ${(cur.rate * 100).toFixed(1)}%
全体の結果: 訪問 ${all.visits}人 / ${c.noun} ${all.signups}人 / ${c.rate} ${(all.rate * 100).toFixed(1)}%${isTool ? ` / シェア ${shares}人` : ""} / 広告費 ${all.adSpendJpy}円
${funnelText(p)}
目標の${c.rate}: ${(targetRate(p.kind, s) * 100).toFixed(1)}% / 1案件の広告費上限: ${s.adBudgetPerProjectJpy}円 / 上限を超えたあと改善に使える追加の広告費: ${s.improveExtraBudgetJpy}円 / これまでの改善回数: ${p.improve_count}回
これまでの経過:
${history}

${outsideText(p.id)}
${researchText(p.id)}`,
  };
}

export async function judge(projectId: number, trigger: JudgeTrigger = "visits") {
  const p = getProject(projectId)!;
  const prompt = judgePrompt(p, trigger);
  const d = await callJson<Decision>({ purpose: "判断", projectId, system: `${prompt.system}\n${EXTRAS_RULE}`, user: prompt.user, validate: isDecision });
  takeExtras(d, { modelId: getSettings().loopModel, scene: "撤退・継続の判断", projectId });
  recordVoiceEffects((d as { voice_effects?: unknown }).voice_effects, { scene: "撤退・継続の判断", modelId: getSettings().loopModel, projectId });
  logEvent(projectId, "ai", "judge", `判断を提案: ${DECISION_LABEL[d.decision]}`);
  // 同じ数字で何度も判断し直さないよう、判断した時点の訪問数と広告費を覚えておく（「広がる」は、遊んだ人とシェアの累計も。次の判定はこのあとの分だけで見る）
  db().prepare("UPDATE projects SET judged_visits = ?, judged_ad_jpy = ?, judged_at = datetime('now') WHERE id = ?").run(prompt.all.visits, prompt.all.adSpendJpy, projectId);
  markSpreadBase(projectId);

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

  // 訪問が判断の基準に届いていない撤退は、全自動でも人に回す（数人の数字で需要がないと決めないため）
  const visits = projectTotals(projectId).visits;
  if (d.decision === "kill" && p.mode === "auto" && s.fullAuto && visits < s.judgeMinVisits) {
    const note = `訪問が${visits}人で、判断の基準（${s.judgeMinVisits}人）に届いていないため、自動では撤退せずに判断をお願いしています`;
    logEvent(projectId, "system", "auto-blocked", note);
    setStage(projectId, "deciding");
    return addApproval(projectId, "decision", DECISION_LABEL[d.decision], `${d.reason}\n（${note}）`, d);
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
  // 開発待ちは、ここ（Claude Code）で作ったツールのHTMLを入れることで進める（承認のボタンでは進めない）
  if (a.kind === "dev" && action === "approve") throw new Error("Claude Code で作ったツールのHTMLを入れてください");
  // じっくり案件のデータの下書きに失敗したものは、データがないので承認できない（作り直すか、人がデータを入れる）
  if (a.kind === "data" && action === "approve" && !(JSON.parse(a.payload ?? "{}") as { dataId?: number }).dataId) {
    throw new Error("確かめるデータがありません。修正を指示して作り直すか、データを自分で入れてください");
  }

  const status = action === "approve" ? "approved" : action === "reject" ? "rejected" : "revised";
  db().prepare("UPDATE approvals SET status = ?, comment = ?, decided_at = datetime('now') WHERE id = ?").run(status, comment ?? null, approvalId);
  const verb = { approve: "承認", reject: "却下", revise: "修正指示" }[action];
  logEvent(a.project_id, "human", "approval", `${verb}: ${a.proposal}${comment ? `（${comment}）` : ""}`);

  const pid = a.project_id;
  if (a.kind === "dev") {
    // 作り直す（設計を直す）指示なら、設計書を書き直して、また開発待ちにする。却下なら、まだ一度も作っていない案件は見送り、公開中の案件は今の版のまま
    // 設計書の書き直しに失敗したら、元の開発待ちに戻す（消えると、HTMLを入れることも、もう一度指示することもできなくなる）
    if (action === "revise") {
      return requestDev(pid, (JSON.parse(a.payload ?? "{}") as { instruction?: string | null }).instruction ?? undefined, comment).catch((e) => {
        db().prepare("UPDATE approvals SET status = 'pending', comment = NULL, decided_at = NULL WHERE id = ?").run(approvalId);
        logEvent(pid, "system", "dev-error", "設計書の書き直しに失敗したため、元の開発待ちに戻しました（もう一度指示するか、HTMLを入れられます）");
        throw e;
      });
    }
    // 却下は、公開の却下と同じ扱い（開発待ちに入っても段階は変わらないため、ここで戻す）
    // 一度も公開していなければ見送り。公開中なら、公開中の版に戻して集客を続ける（今の版がもう公開中の版なら、そのまま集客中にする）
    if (action === "reject") {
      const p = getProject(pid)!;
      if (p.public_slug && p.public_version !== null && p.lp_version === p.public_version) {
        if (p.stage !== "live") setStage(pid, "live");
        logEvent(pid, "system", "revert", `Claude Code での直しは見送り、公開中の第${p.public_version}版のまま集客を続けます`);
        return;
      }
      return rejectPublish(pid);
    }
    return;
  }
  if (a.kind === "data") {
    const dataId = (JSON.parse(a.payload ?? "{}") as { dataId?: number }).dataId;
    db().prepare("UPDATE deep_data SET status = ?, comment = ? WHERE id = ?").run(status, comment ?? null, dataId ?? 0);
    if (action === "reject") return setStage(pid, "rejected");
    if (action === "revise") return prepareDeepData(pid, comment);
    return prepareLp(pid);
  }
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
      // 初めて公開したときは、企画で決めた最初の届け方を、運営者がやること（提案箱）に入れる
      // フォロワーがほぼいない自動投稿だけでは、判断に必要な訪問が集まらないため
      // ねらいが「広がる」の案件は、初めて公開したときに、投稿に使う遊ぶ様子の動画を裏で作っておく
      if (!p.published_at) makePlayVideoOnPublish(p);
      // ねらいが「広がる」の案件は、1日1本出すので運営者の手作業は頼まない（自分の投稿で広がるかを見る）
      if (!p.published_at && asksFirstChannel(p)) {
        addProposal({
          title: `「${p.title}」${FIRST_CHANNEL_TITLE}`,
          how: `${p.first_channel}\nページ: ${publicUrl(projectId) ?? slugOf(projectId)}`,
          why: "自動投稿だけでは届く人数に限りがあり、判断の基準の訪問まで集まらないため（企画のときにAIが決めた最初の届け方）",
          target: "human", source: "plan", scene: "公開", projectId,
        });
      }
      // 無料の場所（Threads・Bluesky）には、公開したその場で1件投稿する（まだ投稿していない場所だけ）
      const { postOnPublish } = await import("./sns");
      if (p.stage !== "hold") await postOnPublish(projectId); // 保留中は、ページを直しても宣伝はしない
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
  // ねらいが「広がる」の案件（育てる段階に入る前）は、決めた日数たったら、遊んだ人とシェアの数だけで見る
  // 当たりなら今の判断の流れ（続ける・育てる）へ。当たらなければ判断せず、承認なしで集客をお休みにする（ページは公開したまま遊べる）
  if (p.aim === "spread" && !p.growth_phase) {
    const since = [p.judged_at ?? p.published_at ?? backfillPublishedAt(p), p.resumed_at].filter((x): x is string => !!x).sort().at(-1);
    if (!since || daysSinceUtc(since) < s.spreadJudgeDays) return false;
    const r = spreadResult(p);
    // 判定の結果を残す（当たりから学ぶ: ねらい・ジャンルごとの成績に使う）
    db().prepare("UPDATE projects SET spread_hit = ? WHERE id = ?").run(r.hit ? 1 : 0, projectId);
    if (r.hit) {
      await judge(projectId, "spread");
      return true;
    }
    restSpread(projectId, `「広がる」の判定: ${s.spreadJudgeDays}日で遊んだ人${r.plays}人・シェア${r.shares}件で、当たりの基準（遊んだ人${s.spreadHitPlays}人以上か、シェア${s.spreadHitShares}件以上）に届かなかった`);
    return true;
  }
  const all = projectTotals(projectId);
  const enoughVisits =
    projectTotals(projectId, p.lp_version).visits >= s.judgeMinVisits && all.visits - p.judged_visits >= s.judgeMinVisits / 2;
  // 上限と「上限＋改善用の追加分」の2つの線のどちらかを、前回の判断のあとで越えたら判断する
  const lines = [s.adBudgetPerProjectJpy, s.adBudgetPerProjectJpy + s.improveExtraBudgetJpy];
  const budgetHit = lines.some((line) => all.adSpendJpy >= line && p.judged_ad_jpy < line);
  // 訪問が少なくても、公開（または前の判断）から決めた日数がたったら判断する（人が来ないまま止まり続けないように）
  const publishedAt = p.published_at ?? backfillPublishedAt(p);
  // 保留から戻したばかりの案件は、戻した日から数える
  const since = [p.judged_at ?? publishedAt, p.resumed_at].filter((x): x is string => !!x).sort().at(-1);
  const slow = !!since && daysSinceUtc(since) >= s.judgeAfterDays;
  // 日数で判断する2日前に、企画で決めた最初の届け方がまだなら、運営者に1回だけ知らせる
  // （やらないまま判断すると、届け方の問題を需要の問題と取り違えるため）
  if (since && !slow && !enoughVisits && !budgetHit && daysSinceUtc(since) >= s.judgeAfterDays - 2) remindFirstChannel(p);
  if (!enoughVisits && !budgetHit && !slow) return false;
  await judge(projectId, enoughVisits ? "visits" : budgetHit ? "budget" : "slow");
  return true;
}

// 初めて公開したときに、企画で決めた最初の届け方を運営者に頼むか（「広がる」は頼まない。1日1本出すので、毎日の手作業になるため）
export const asksFirstChannel = (p: Pick<ProjectRow, "first_channel" | "aim">) => !!p.first_channel && p.aim !== "spread";

// 企画で決めた最初の届け方（公開したときに、運営者がやることとして提案箱に入れたもの）を、やったかどうか
// 提案箱の返事（やった・見送り）を、そのまま実施の記録として使う
// 公開したときに入れる届け方のお願いの題の終わり（ほかの「公開」のお願いと見分けるのに使う）
const FIRST_CHANNEL_TITLE = "を、対象の人がいる場所に届ける";
export type FirstChannelState = { status: "open" | "done" | "declined"; note: string | null; at: string };
export function firstChannelState(projectId: number): FirstChannelState | null {
  const r = db().prepare(`SELECT status, note, COALESCE(decided_at, created_at) AS at FROM plan_requests
     WHERE project_id = ? AND target = 'human' AND source = 'plan' AND scene = '公開' AND title LIKE ? ORDER BY id DESC LIMIT 1`)
    .get(projectId, `%${FIRST_CHANNEL_TITLE}`) as { status: string; note: string | null; at: string } | undefined;
  if (!r) return null;
  return { status: r.status === "done" ? "done" : r.status === "declined" ? "declined" : "open", note: r.note, at: r.at };
}
export function firstChannelLabel(x: FirstChannelState | null): string {
  if (!x) return "記録なし（公開したときに提案箱へ入っていない）";
  if (x.status === "done") return `運営者がやった${x.note ? `（ひとこと: ${x.note}）` : ""}`;
  if (x.status === "declined") return `運営者が見送った${x.note ? `（理由: ${x.note}）` : ""}`;
  return "まだやっていない（提案箱で運営者の返事待ち）";
}
function remindFirstChannel(p: ProjectRow) {
  if (firstChannelState(p.id)?.status !== "open") return;
  const sent = db().prepare("SELECT 1 FROM events WHERE project_id = ? AND kind = 'channel-remind' LIMIT 1").get(p.id);
  if (sent) return;
  logEvent(p.id, "system", "channel-remind", "企画で決めた最初の届け方が、まだやっていません。2日ほどで、訪問が少ないまま判断します（提案箱の「運営者へのお願い」）");
  notifyHuman(`${projectTitle(p.id)}企画で決めた最初の届け方がまだです。2日ほどで判断に入ります（提案箱）`);
}

// ---- 保留: 今は集客しても届かない案件（季節ものなど）を、公開したまま休ませる ----
// 宣伝の投稿・撤退や継続の判断・ページの改善を止める（stage が live でなくなるので、それぞれの処理の対象から外れる）
// 訪問・利用・外の声の記録は続ける。保留にできるのは人だけ（AIは提案箱で提案するだけ）
export const HOLD_MAX_DAYS = 90;
export const HOLD_SEASONAL_MAX_DAYS = 365;

export const jstToday = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date());

// 保留にする。すでに保留中なら、理由と再開日を更新する（延長）
export function holdProject(projectId: number, reason: string, until: string, seasonal = false) {
  const p = getProject(projectId);
  if (!p || !["live", "hold"].includes(p.stage)) throw new Error("集客中かお休み中の案件だけ、集客をお休みにできます");
  if (buildingNow(projectId)) throw new Error("この案件はAIが作業中です。終わってから集客をお休みにしてください");
  if (db().prepare("SELECT 1 FROM approvals WHERE project_id = ? AND status = 'pending'").get(projectId)) throw new Error("この案件には承認待ちがあります。先に判断してください");
  const why = reason.trim().slice(0, 200);
  if (!why) throw new Error("集客をお休みにする理由を書いてください");
  const day = (s: string) => Date.parse(`${s}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(until) || Number.isNaN(day(until))) throw new Error("再開日の形式が正しくありません");
  const days = Math.round((day(until) - day(jstToday())) / 86_400_000);
  const max = seasonal ? HOLD_SEASONAL_MAX_DAYS : HOLD_MAX_DAYS;
  if (days < 1) throw new Error("再開日は明日以降にしてください");
  if (days > max) throw new Error(`再開日は${max}日以内にしてください${seasonal ? "" : "（季節ものは「季節もの」に印を付けると1年まで）"}`);
  const extending = p.stage === "hold";
  db().prepare("UPDATE projects SET stage = 'hold', hold_reason = ?, hold_until = ?, updated_at = datetime('now') WHERE id = ?").run(why, until, projectId);
  logEvent(projectId, "human", "hold", `${extending ? "集客のお休みの期間を変更しました" : "集客をお休みにしました"}（公開は続けます。${until}に集客へ戻します。それまで宣伝・判断・改善を止めます）`);
}

// 遊んだ人（利用）とシェアの、今の累計
function spreadTotals(projectId: number): { plays: number; shares: number } {
  const all = projectTotals(projectId);
  return { plays: all.signups, shares: all.rows.reduce((n, r) => n + (r.shares ?? 0), 0) };
}
// 「広がる」の判定の起点を、今の累計にする（判断したとき・集客に戻したとき）
export function markSpreadBase(projectId: number) {
  const t = spreadTotals(projectId);
  db().prepare("UPDATE projects SET spread_base_plays = ?, spread_base_shares = ? WHERE id = ?").run(t.plays, t.shares, projectId);
}
// 「広がる」の案件の、判定の起点（公開・前回の判断・再開）からの遊んだ人の数・シェアの数と、当たりの基準を超えたか（どちらかが基準以上なら当たり）
export function spreadResult(p: Pick<ProjectRow, "id" | "spread_base_plays" | "spread_base_shares">): { plays: number; shares: number; hit: boolean } {
  const s = getSettings();
  const t = spreadTotals(p.id);
  const plays = Math.max(0, t.plays - (p.spread_base_plays ?? 0));
  const shares = Math.max(0, t.shares - (p.spread_base_shares ?? 0));
  return { plays, shares, hit: plays >= s.spreadHitPlays || shares >= s.spreadHitShares };
}

// 「広がる」で当たらなかった案件を、承認なしで集客お休みにする（ページは公開したまま遊べる。宣伝・判断・改善を止める。再開日は決めない）
export function restSpread(projectId: number, why: string) {
  db().prepare("UPDATE projects SET stage = 'hold', hold_reason = ?, hold_until = NULL, updated_at = datetime('now') WHERE id = ?").run(why.slice(0, 200), projectId);
  logEvent(projectId, "system", "hold", `${why}ため、集客をお休みにしました（ページは公開したまま遊べます。宣伝・判断・改善を止めます。再開日は決めていないので、集客に戻すときは手で戻してください）`);
}

// 集客に戻す。保留中に増えた訪問では、戻った瞬間に判断しない
export function resumeProject(projectId: number, by: "human" | "system" = "human") {
  const p = getProject(projectId);
  if (p?.stage !== "hold") throw new Error("集客をお休みしている案件ではありません");
  db().prepare("UPDATE projects SET stage = 'live', hold_reason = NULL, hold_until = NULL, resumed_at = datetime('now'), judged_visits = ?, updated_at = datetime('now') WHERE id = ?")
    .run(projectTotals(projectId).visits, projectId);
  // 「広がる」は、戻したあとの遊んだ人とシェアだけで次の判定をする
  markSpreadBase(projectId);
  logEvent(projectId, by, "resume", by === "human" ? "集客のお休みをやめて、集客に戻しました" : "再開日になったので、集客のお休みから集客に戻しました");
}

// 再開日が来た案件を、集客に戻す（毎回の定期処理から呼ぶ）
export function resumeDueHolds(): number {
  const due = db().prepare("SELECT id FROM projects WHERE stage = 'hold' AND hold_until <= ?").all(jstToday()) as { id: number }[];
  for (const { id } of due) resumeProject(id, "system");
  return due.length;
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

// 今の流入で、判断の基準の訪問まで届けられる案件の数。案件を増やすほど1件あたりの訪問が薄まり、どれも判断できなくなるため
// 直近7日の本物の訪問から1日あたりを出し、(判断までの日数 × 2) のうちに基準へ届く件数とする。並行して比べられるよう最低2件
export function trafficCapacity(): { perDay: number; projects: number } {
  const s = getSettings();
  // metrics.day は日本時間の日付。今日を含む7日間（6日前〜今日）を数える
  const today = jstToday();
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - 6 * 86_400_000).toISOString().slice(0, 10);
  const v = (db().prepare("SELECT COALESCE(SUM(m.visits), 0) AS n FROM metrics m JOIN projects p ON p.id = m.project_id WHERE m.source != 'simulated' AND p.demo = 0 AND m.day >= ? AND m.day <= ?").get(since, today) as { n: number }).n;
  const perDay = Math.round((v / 7) * 10) / 10;
  const projects = Math.max(2, Math.floor((perDay * s.judgeAfterDays * 2) / Math.max(1, s.judgeMinVisits)));
  return { perDay, projects };
}

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
    // 「広がる」の案件は別に数え、上限に達したねらいだけを出さない（全部のねらいが作れないときだけ休む）
    if (pending >= s.maxPending) return skip(`承認待ちが${pending}件たまっているため、アイデア出しを休みました（上限${s.maxPending}件）`);
    const live = liveCounts().normal;
    const blocks = aimBlocks({ daily: true });
    // 今の流入で、判断の基準まで届けられる件数（「広がる」は自分の投稿で広がるかを見るので、ここでは数えない）
    const cap = trafficCapacity();
    if (live < s.maxLive && live >= cap.projects) {
      const why = `直近7日の訪問は1日あたり約${cap.perDay}人で、集客中の${live}件を${s.judgeAfterDays * 2}日のうちに判断の基準（${s.judgeMinVisits}人）まで届けられる見込みがない（今の流入で育てられるのは${cap.projects}件まで）`;
      for (const a of AIM_KEYS) if (a !== "spread") blocks[a] = why;
    }
    const weights = aimWeightsOf(s);
    const used = AIM_KEYS.filter((a) => weights[a] > 0);
    if ((used.length ? used : AIM_KEYS).every((a) => blocks[a])) return skip(`${[...new Set(Object.values(blocks))].join("。")}ため、アイデア出しを休みました`);
    const paused = planPausesNew();
    if (paused) return skip(`今日の計画で、新しい案件づくりを休むと決めたため休みました（${paused}）`);

    // 月の予算のペースに合わせて、今日新しく作る案件の数を決める（1件ごとの作り方は変えない）
    const b = budgetState();
    if (!b.creativeOk) return skip(`今月の予算の${Math.round((b.creativeCap / b.budget) * 100)}%を使ったため、新しい案件は休みました（残りはSNSの投稿と判断に使います）`);
    if (b.newToday === 0) return skip(`予算のペースを守るため、今日は新しい案件を休みました（今日使える額 約${Math.round(b.allowanceToday)}円・1件 約${Math.round(b.perProject)}円）`);
    // ほかのアイデア出しが動いていたら、今回は見送って次の確認（5分後）に回す（実行済みの印は付けない）
    const busy = ideaRunning();
    if (busy) return { ran: false, message: `いま「${busy}」が動いているため、終わってから実行します`, projectIds: [] };
    const exclude = Object.keys(blocks) as Aim[];
    if (exclude.length) logEvent(null, "system", "daily", `毎日の自動実行: 今日は ${exclude.map((a) => AIMS[a].label).join("・")} を出しません（${[...new Set(Object.values(blocks))].join("。")}）`);
    const { candidates, kept } = await withIdeaLock("毎日のアイデア出し", () => gatherAndScoreIdeas(s.dailyIdeaCount, b.newToday, false, { exclude, spreadRoom: spreadRoom({ daily: true }) }));
    if (!candidates.length) return skip("どのAIからもアイデアを得られなかったため休みました");
    const ids: number[] = [];
    const gate = createGate({ daily: true });
    for (const c of kept) {
      // 会議の間に、そのねらいの上限に達していたら作らない（会議の前の確かめだけに頼らない）
      const late = gate(aimOfIdea(c.idea));
      if (late) {
        logEvent(null, "ai", "idea-skipped", `アイデア「${c.idea.title}」は、案件にしませんでした（${late}）`);
        continue;
      }
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
const AIM_KEYS_ALL: readonly Aim[] = AIM_KEYS;
const AIM_KEYS_TOOL: Aim[] = AIM_KEYS.filter((a) => AIMS[a].kind === "tool");
// ねらいの配分を守るために、点の低い案を案件にしない下限（平凡な案は5点前後）。下回るなら配分より点数を優先する
const AIM_PICK_FLOOR = 5;

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

// exclude: いま作れないねらい（集客中の上限など）。spreadRoom: 今回案件にしてよい「広がる」の件数
async function gatherAndScoreIdeas(perModel: number, keep: number, practice = false, opts: { title?: string; alsoExisting?: string[]; theme?: string; noRevival?: boolean; deepOnly?: boolean; aim?: Aim; exclude?: Aim[]; spreadRoom?: number } = {}): Promise<{ candidates: Candidate[]; kept: Candidate[] }> {
  const authors = ideaAuthors();
  // ねらいの配分: 運営者がねらいを選んだらそれだけ、じっくり案件だけならツールのねらいだけ。いま作れないねらいは出させない。各社に交互に配る
  const weights = aimWeightsOf(getSettings());
  const base: Aim[] = opts.aim ? [opts.aim] : opts.deepOnly ? AIM_KEYS_TOOL : [...AIM_KEYS_ALL];
  const narrowed = base.filter((a) => !opts.exclude?.includes(a));
  const allowed: Aim[] = narrowed.length ? narrowed : base;
  const dealt = dealAims(allocateAims(perModel * authors.length, weights, allowed), authors.length);
  const batchId = `${Date.now()}`;
  const act = `ideas-${batchId}`;
  const title = opts.title ?? (practice ? "アイデア出し（見るだけ）" : "毎日のアイデア出し");
  const prov = (id: string) => modelInfo(id).provider;
  try {
  // 0. 今日（日本時間）まだ検索していなければ、Xで話題の投稿と「欲しい」の声を検索して、まとめ終わるまで待つ（見るだけのときは検索しない）
  if (!practice) {
    setStep(`${act}-search`, title, "X の検索", "今日の話題の投稿と「欲しい」の声を確かめています");
    try {
      await searchBeforeIdeas();
    } finally {
      liveEnd(`${act}-search`);
    }
  }
  authors.forEach((a) => setStep(act, title, modelLabel(a), "アイデアを考えています"));

  // 1. 各社にアイデアを出させる（失敗したAIは飛ばす）。届いた順に、ライブ画面にすぐ出す
  const results = await Promise.all(
    authors.map(async (author, ai) => {
      try {
        const ideas = await askIdeas(opts.theme ?? "", perModel, author, opts.alsoExisting, opts.deepOnly, dealt[ai]);
        setStep(act, title, modelLabel(author), `アイデア${ideas.length}件を出しました。ほかの社を待っています`);
        for (const idea of ideas) {
          liveNote({ who: modelLabel(author), provider: prov(author), kind: `アイデアを提案（${AIMS[aimOfIdea(idea)].label}・${idea.kind === "tool" ? "動くツール" : "事前登録LP"}${idea.genre ? `・${idea.genre}` : ""}・${idea.season === "seasonal" ? "季節もの" : "1年中"}）`, text: `「${idea.title}」— ${idea.solution}${idea.channel ? `\n届け方: ${idea.channel}` : ""}`, batch: batchId });
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
    .map((c) => `【${c.label}】${c.idea.title}（ねらい: ${aimOfIdea(c.idea)}・形: ${c.idea.kind === "tool" ? "tool" : "lp"}${c.idea.genre ? `・ジャンル: ${c.idea.genre}` : ""}）\n対象: ${c.idea.target}\n${aimOfIdea(c.idea) === "spread" ? "刺さる気持ち" : aimOfIdea(c.idea) === "return" ? "毎日来る動機" : "課題"}: ${c.idea.problem}\n解決策: ${c.idea.solution}\n仮説: ${c.idea.hypothesis}\n需要の時期: ${c.idea.season === "seasonal" ? "季節もの" : c.idea.season === "evergreen" ? "1年中" : "（書かれていない）"}\n最初の届け方: ${c.idea.channel ?? "（書かれていない）"}\n最初の1週間の検証: ${c.idea.first_test ?? "（書かれていない）"}\n代わりになる既存の無料サービスとの違い: ${c.idea.alternative ?? "（書かれていない）"}${isDeepIdea(c.idea) ? `\nじっくり案件（ふつうの tool の制限を外して作り込む）: ${c.idea.deep}${isStr(c.idea.deep_data) && c.idea.deep_data.trim() ? `\n要るデータ（AIが下書きし、人が確かめてから作る）: ${c.idea.deep_data}` : ""}` : ""}${wantLine(c.idea.want_id)}`)
    .join("\n\n");
  const scoreRow = db().prepare("INSERT INTO idea_scores (candidate_id, scorer_model, score, reason) VALUES (?, ?, ?, ?)");
  authors.forEach((a) => setStep(act, title, modelLabel(a), `作者を伏せた${candidates.length}件を採点しています`));
  await Promise.all(
    authors.map(async (scorer) => {
      try {
        const out = await callJson<{ scores: { label: string; score: number; reason: string }[] }>({
          purpose: "アイデアの採点",
          modelId: scorer,
          system: `あなたは事業アイデアの審査員です。作者が誰かは分かりません。各アイデアには、ねらい（何をもって当たりとするか）が付いています。ねらいごとの観点で、各アイデアを1〜10点で採点します。ねらいが違う案どうしでも、それぞれのねらいでどれだけ当たりそうかを同じ物差し（10点満点）で比べる。
ねらいが spread（広がる。遊び・ネタで、見た人が触ってシェアし、フォロワーが増える）の案は、次で見る（役に立つかでは見ない）:
- 何をするものか1秒で伝わるか（短い動画の最初の1秒・結果の画像で分かるか）
- 触ってみたくなるか。30秒ほどで遊べるか
- 結果やオチを人に見せたくなる・誰かに送りたくなるか（人によって結果が違うか）
- 作った人の次の作品も見たいと思えるか
- 似た遊び・診断・ゲームとの違いがあるか。実在の人物・既存の作品に頼っていないか、人をばかにするネタでないか（頼っているもの・ばかにするものは大きく減点する）
ねらいが return（また来てもらう）の案は、毎日変わる理由がはっきりしているか、明日も来たくなる仕組みがあるか、1回が短いか、結果をシェアできるかで見る。
ねらいが useful（役に立つ）・demand（需要を確かめる）の案は、次で見る:
- 対象者が具体的で、その人に安く届けられるか
- 「最初の届け方」が具体的で現実的か（広告なし・フォロワーほぼ0のアカウントと手作業で、本当に最初の利用者に会えるか）。曖昧なもの・書かれていないものは大きく減点する。自分の投稿（タグ付け）だけで、運営者が手でできる直接の接点（コミュニティの管理者への相談・知人に使ってもらう など）が入っていないものも減点する。他人の投稿への宣伝の返信・知らない人へのDMを使う案は大きく減点する
- 困りごと・欲しい気持ちが強く、事前登録したくなるか（形が tool なら、使ってシェアしたくなるか）
- 選んだ形（lp=事前登録LP / tool=1ページで完結する動くツール）が、そのアイデアに合っているか。tool なら外部の通信なしで本当に作れるか（じっくり案件は、書かれたデータを先に用意すれば作れるかで見る。データが大きいことでは減点しない。データがすぐ古くなるのに、更新の手立てが書かれていないものは減点する）
- プロダクトの種類（Webサービス・スマホアプリ・拡張機能・ボット・デジタル商品など）では差をつけない。lp は作る前に需要を確かめるものなので、作るのが大変なことでは減点しない
- 既存の無料サービスとの違いがはっきりしているか（「代わりになる既存の無料サービスとの違い」が書かれていない・名前がない・違いが弱いものは減点する）
どのねらいでも、次も見る:
- tool なら、外部の通信なしで本当に作れるか
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
  // じっくり案件は直近7日の上限まで。上限を超えた案は、縮めて作らず、次の案に回す
  // 運営者が「じっくり案件だけ」を頼んだときも、人が選んだので上限で止めない
  let deepLeft = practice || opts.deepOnly ? Infinity : deepAllowance();
  // 今回案件にするじっくり案件の数（開発待ちの上限に、これから開発待ちになる分も数える）
  let deepMade = 0;
  // 今回案件にする、人の作業待ちになる案の数
  let needsMade = 0;
  // ねらいの配分を守る: 最近30日の案件を数え、配分に比べていちばん足りないねらいから、点の高い案を選ぶ（pickByAims）
  const aimCounts: Partial<Record<Aim, number>> = {};
  for (const r of db().prepare("SELECT aim, COUNT(*) AS n FROM projects WHERE demo = 0 AND aim IS NOT NULL AND created_at >= datetime('now', '-30 days') GROUP BY aim").all() as { aim: string; n: number }[]) {
    if (isAim(r.aim)) aimCounts[r.aim] = r.n;
  }
  let spreadLeft = practice ? Infinity : opts.spreadRoom ?? Infinity;
  const kept = pickByAims(candidates.map((c) => ({ c, aim: aimOfIdea(c.idea), avg: c.avg, author: c.author })), keep, weights, aimCounts, allowed, AIM_PICK_FLOOR, ({ c, aim }) => {
    // 「広がる」は今回案件にしてよい件数まで（同時に集客中の上限・1日の上限）、じっくり案件は直近7日の上限まで
    // どちらの条件も通ってから枠を減らす（片方で外れた案が、もう片方の枠を使わないように）
    const deep = isDeepIdea(c.idea);
    const needs = deep ? needsOf(c.idea.needs) : [];
    if (aim === "spread" && spreadLeft <= 0) {
      logEvent(null, "system", "spread-skipped", `アイデア「${c.idea.title}」は「広がる」ですが、今回作ってよい件数を超えるため、案件にしません`);
      return false;
    }
    // まだない仕組みが要る案は、人の作業待ちに止めるだけなので、週の上限や開発待ちには数えず、人の作業待ちの上限で見る（人が頼んだときは止めない）
    if (needs.length) {
      if (!practice && !opts.deepOnly && needsWaiting() + needsMade >= getSettings().needsWaitMax) {
        logEvent(null, "system", "needs-skipped", `アイデア「${c.idea.title}」は、まだない仕組み（${needs.map((n) => NEED_KINDS[n.kind].label).join("・")}）が要りますが、人の作業待ちが${getSettings().needsWaitMax}件以上になるため、今回は案件にしません`);
        return false;
      }
      if (aim === "spread") spreadLeft--;
      needsMade++;
      return true;
    }
    if (deep && deepLeft <= 0) {
      logEvent(null, "system", "deep-skipped", `アイデア「${c.idea.title}」はじっくり案件ですが、直近7日の上限に達しているため、今回は案件にしません`);
      return false;
    }
    // 開発待ちが溜まっているあいだは、新しいじっくり案件を作らない（Claude Code で作るのが追いつかないまま増やさない。人が頼んだときは止めない）
    if (deep && !practice && !opts.deepOnly && devWaiting() + deepMade >= getSettings().deepDevWaitMax) {
      logEvent(null, "system", "deep-skipped", `アイデア「${c.idea.title}」はじっくり案件ですが、開発待ちが${getSettings().deepDevWaitMax}件以上になるため、今回は案件にしません`);
      return false;
    }
    if (aim === "spread") spreadLeft--;
    if (deep) {
      deepLeft--;
      deepMade++;
    }
    return true;
  }).map((x) => x.c);
  if (!practice && !opts.noRevival) proposeRevival(candidates.filter((c) => !kept.includes(c)));
  const best = [...candidates].sort((a, b) => b.avg - a.avg)[0];
  if (best) liveNote({ who: "システム", provider: null, kind: "採点の結果", text: `1位は「${best.idea.title}」（${modelLabel(best.author)}の案・平均${best.avg.toFixed(1)}点）${practice ? "。見るだけなので、案件にはしません" : kept.length ? `。ねらいの配分も見て、${kept.map((k) => `「${k.idea.title}」（${AIMS[aimOfIdea(k.idea)].label}・${k.avg.toFixed(1)}点）`).join("・")}を案件にします` : opts.noRevival ? "。新しい案件を休んでいるため、案件にはしません" : ""}`, batch: batchId });
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
      .prepare("SELECT v.project_id, v.version FROM lp_versions v JOIN projects p ON p.id = v.project_id WHERE p.demo = 0 AND p.kind = 'lp' AND p.stage != 'hold' AND v.author_model = ?")
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
    const traffic = projectIds.filter((id) => getProject(id)?.stage !== "hold").map((id) => projectTotals(id)).filter((t) => t.visits > 0); // 保留中の案件は割合に入れない
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
    const withTraffic = mine.filter((p) => p.stage !== "hold").map((p) => projectTotals(p.id)).filter((t) => t.visits > 0); // 保留中の案件は割合に入れない
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
