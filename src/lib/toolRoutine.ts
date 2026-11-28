import crypto from "node:crypto";
import { db, getSettings, type ApprovalRow } from "./db";
import { getProject, lastDevDesign, logEvent, projectTitle, type Lp } from "./loop";
import { atMs, fireRoutine, routineConfigured, type Fetch } from "./routine";
import { notifyHuman } from "./liveNotify";

// 案件のツールを、クラウドの Claude Code（ルーティン「案件のツールを作る」）に作ってもらう
// じっくり案件は、AIが設計書を書いたあと、人が手元の Claude Code で作って入れるのを待っていた（開発待ちが8件たまっていた）。
// 開発待ちになったものを、ルーティンに頼む。ルーティンはダッシュボードの入口（/api/tool-jobs）から設計書・データを読み、作ったツールを入れる。
// 入れたあとは、人が入れたときと同じく、チェック・動作の確かめ・紹介ページづくり・公開の判断に進む（運営者が決めた）
// - ルーティンの起動の URL とトークン: CLAUDE_TOOL_ROUTINE_FIRE_URL・CLAUDE_TOOL_ROUTINE_TOKEN（Railway の変数）
// - ルーティンがダッシュボードに入る合言葉: LAB_TOOL_TOKEN（Railway と、ルーティンの環境の変数）
// - 自動で頼むか・同時に頼む数・1日に頼む数は、設定で決める（ルーティンはサブスクの使用量で動くので、運営者が決めた）

const URL_VAR = "CLAUDE_TOOL_ROUTINE_FIRE_URL";
const TOKEN_VAR = "CLAUDE_TOOL_ROUTINE_TOKEN";
// 頼んでから入れるまでの作業中とみなす時間（これを過ぎても入っていなければ、作業は終わったとみなす）
export const ROUTINE_WORK_MS = 3 * 60 * 60 * 1000;
// 手で頼み直せるまでの時間
const RETRY_MS = 60 * 60 * 1000;
// 自動で頼む回数の上限（最初の1回と、入らなかったときの頼み直し1回。運営者が決めた）。これを使い切って入らなかったものは、人の判断待ちに出す
export const AUTO_TRIES = 2;
const DAY_MS = 24 * 60 * 60 * 1000;

export const toolRoutineConfigured = () => routineConfigured(URL_VAR, TOKEN_VAR) && labTokenConfigured();
const labTokenConfigured = () => (process.env.LAB_TOOL_TOKEN ?? "").length >= 32;

// ルーティンが送ってきた合言葉が正しいか（比べる時間で中身が推測されないよう、最後まで比べる）
export function labTokenOk(header: string | null): boolean {
  const want = process.env.LAB_TOOL_TOKEN ?? "";
  if (want.length < 32 || !header?.startsWith("Bearer ")) return false;
  const got = Buffer.from(header.slice(7));
  const exp = Buffer.from(want);
  return got.length === exp.length && crypto.timingSafeEqual(got, exp);
}

// 作業中か（頼んでから3時間以内で、まだ開発待ち）
const working = (a: Pick<ApprovalRow, "status" | "routine_at">, now: number) => a.status === "pending" && !!a.routine_at && now - atMs(a.routine_at) < ROUTINE_WORK_MS;

// 今のツールがあるか（紹介ページのデータがあっても、ツールがまだないことがある。PR #130 の ai-review の指摘）
export function hasTool(lp: string | null): boolean {
  if (!lp) return false;
  try {
    return !!(JSON.parse(lp) as Lp).tool?.html;
  } catch {
    return false;
  }
}

// 起動のときに渡す直す指示の長さ（これを超える分は、ダッシュボードの依頼文から読む）
const INSTRUCTION_IN_FIRE = 1500;

// ルーティンに渡す文（ルーティンの側では、外から来た信用しない文として受け取る）
export function toolRoutineText(a: ApprovalRow): string {
  const p = getProject(a.project_id)!;
  const payload = JSON.parse(a.payload ?? "{}") as { instruction?: string | null };
  return [
    `案件 #${p.id}「${p.title}」`,
    p.deep ? "じっくり案件" : "ふつうの案件",
    hasTool(p.lp) ? "直す（今のツールがある）" : "新しく作る",
    `開発待ちの番号: ${a.id}`,
    // 起動のときに渡す文は短くする。切ったときは、全文がダッシュボードの依頼文にあると書き添える（ルーティンは作業の最初に依頼文を丸ごと読む）
    payload.instruction ? `直す指示: ${payload.instruction.length > INSTRUCTION_IN_FIRE ? `${payload.instruction.slice(0, INSTRUCTION_IN_FIRE)}…（ここまで。全文はダッシュボードの依頼文にあります）` : payload.instruction}` : "",
  ].filter(Boolean).join("\n");
}

// 開発待ちを1件、ルーティンに頼む（manual: 運営者が押したとき。自動の数の上限は見ない）
export async function startToolRoutine(approvalId: number, opts: { manual?: boolean; fetchImpl?: Fetch; now?: number } = {}): Promise<string | null> {
  if (!toolRoutineConfigured()) throw new Error("ツールを作るルーティンがまだつながっていません");
  const now = opts.now ?? Date.now();
  const a = db().prepare("SELECT * FROM approvals WHERE id = ?").get(approvalId) as ApprovalRow | undefined;
  if (!a || a.kind !== "dev" || a.status !== "pending") throw new Error("ルーティンに頼める開発待ちが見つかりません");
  if (a.routine_at && now - atMs(a.routine_at) < RETRY_MS) throw new Error("頼んだばかりです。1時間たってから、もう一度頼めます");
  // 起動する前に「頼んだ」を先に記録し、記録できた呼び出しだけが起動する（見回りと運営者のボタンが同時に来ても、2回起動しない。PR #130 の ai-review の指摘）
  const stamp = Math.floor(now / 1000);
  const claimed = db().prepare(`UPDATE approvals SET routine_at = datetime(?, 'unixepoch'), routine_url = NULL, routine_tries = routine_tries + 1
    WHERE id = ? AND kind = 'dev' AND status = 'pending' AND (routine_at IS NULL OR routine_at <= datetime(?, 'unixepoch'))`).run(stamp, approvalId, stamp - RETRY_MS / 1000).changes;
  if (!claimed) throw new Error("頼んだばかりです。1時間たってから、もう一度頼めます");
  let url: string | null;
  try {
    url = await fireRoutine(URL_VAR, TOKEN_VAR, toolRoutineText(a), opts.fetchImpl);
  } catch (e) {
    // 起動できなかったら、頼んだ記録を元に戻す
    db().prepare("UPDATE approvals SET routine_at = ?, routine_url = ?, routine_tries = ? WHERE id = ?").run(a.routine_at, a.routine_url, a.routine_tries, approvalId);
    throw e;
  }
  db().prepare("UPDATE approvals SET routine_url = ? WHERE id = ?").run(url, approvalId);
  // 1日に頼んだ数は、この経過の数で数える（同じ開発待ちを頼み直した分も、1回ずつ数える）
  logEvent(a.project_id, opts.manual ? "human" : "system", "tool-routine", `ツールを${hasTool(getProject(a.project_id)?.lp ?? null) ? "直す" : "作る"}のを、クラウドの Claude Code（ルーティン）に頼みました${opts.manual ? "（運営者が頼んだ）" : ""}`);
  return url;
}

// 24時間以内にルーティンに頼んだ日時（古い順。手で頼んだ分・頼み直した分も、1回ずつ数える）
// 自動で頼む処理（autoToolRoutine）と画面の様子（toolRoutineStatus）で同じものを使う（数え方が食い違わないように。PR #233 の ai-review の指摘）
function firedSince(now: number): string[] {
  return (db().prepare("SELECT at FROM events WHERE kind = 'tool-routine' AND at > datetime(?, 'unixepoch') ORDER BY at").all(Math.floor((now - DAY_MS) / 1000)) as { at: string }[]).map((r) => r.at);
}

// 頼む順番を待っている開発待ち（まだ頼んでいないものが先、頼み直しが残っているものはそのあと。作業中のものは入れない）
// 自動で頼む処理と画面の様子で同じものを使う（PR #233 の ai-review の指摘）
function routineQueue<T extends Pick<ApprovalRow, "status" | "routine_at" | "routine_tries">>(rows: T[], now: number): T[] {
  const pending = rows.filter((x) => x.status === "pending");
  return [...pending.filter((x) => !x.routine_at), ...pending.filter((x) => x.routine_at && x.routine_tries < AUTO_TRIES && !working(x, now))];
}

// 開発待ちを、設定の数の範囲で自動で頼む（見回りのたびに見る）。頼んだ数を返す
// 同時に頼む数: 作業中（頼んで3時間以内でまだ入っていない）の数。1日に頼む数: 24時間以内に頼んだ回数（手で頼んだ分・頼み直した分も数える）
// 頼んで3時間たっても入らなかったものは、自動で1回だけ頼み直す（AUTO_TRIES。運営者が決めた）。それでも入らなければ、人の判断待ちに出す（autoWork）
// まだ頼んでいないものを先に、頼み直しはそのあと
export async function autoToolRoutine(opts: { fetchImpl?: Fetch; now?: number } = {}): Promise<number> {
  const s = getSettings();
  const now = opts.now ?? Date.now();
  const rows = db().prepare("SELECT a.* FROM approvals a JOIN projects p ON p.id = a.project_id WHERE a.kind = 'dev' AND p.demo = 0 AND (a.status = 'pending' OR a.routine_at IS NOT NULL) ORDER BY a.id").all() as ApprovalRow[];
  // 頼み直しを使い切っても入らなかったものは、判断待ちに移ったことを人に1回だけ知らせる（AIの作業待ちから黙って移らないように。運営者が決めた）
  // 自動で頼む設定をオフにした・止めるスイッチを入れたあとでも知らせるよう、頼むかどうかを決める前に見る（PR #167 の ai-review の指摘）
  for (const a of rows.filter((x) => x.status === "pending" && x.routine_at && x.routine_tries >= AUTO_TRIES && !working(x, now))) {
    const tag = `（開発待ち #${a.id}）`;
    if (db().prepare("SELECT 1 FROM events WHERE kind = 'tool-routine-gave-up' AND message LIKE ?").get(`%${tag}`)) continue;
    logEvent(a.project_id, "system", "tool-routine-gave-up", `ルーティンに${a.routine_tries}回頼みましたが、ツールが入らなかったので、判断待ちに出しました${tag}`);
    notifyHuman(`${projectTitle(a.project_id)}あなたの判断待ち: ルーティンに${a.routine_tries}回頼んでもツールが入りませんでした。作業の様子を見て、頼み直すか手で作ってください`);
  }
  if (!s.toolRoutineAuto || s.killSwitch || !toolRoutineConfigured()) return 0;
  const inFlight = rows.filter((a) => working(a, now)).length;
  const today = firedSince(now).length;
  let slots = Math.min(s.toolRoutineConcurrent - inFlight, s.toolRoutinePerDay - today);
  let n = 0;
  for (const a of routineQueue(rows, now)) {
    if (slots <= 0) break;
    try {
      await startToolRoutine(a.id, { fetchImpl: opts.fetchImpl, now });
      n++;
      slots--;
    } catch (e) {
      logEvent(a.project_id, "system", "tool-routine-error", `ツールを作るルーティンに頼めませんでした: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`);
      break; // 起動できないときは、続けて頼まない（次の見回りでまた見る）
    }
  }
  return n;
}

// AIの作業待ちの画面に出す、ルーティンに自動で頼む今の様子（11/28 に運営者が決めた。#79 が開発待ちのまま約40分自動で頼まれず、
// 上限で待っているのか・設定で止まっているのかが画面から分からなかったため。提案箱の「自動の依頼」の欄と同じ考え）
export type ToolRoutineStatus = {
  off: string | null; // 自動で頼まない理由（設定・止めるスイッチ・つながっていない）。動いていれば null
  working: { projectId: number; title: string; at: string }[]; // 作業中（頼んで3時間以内で、まだ入っていない）
  concurrent: number; // 同時に頼む数の上限
  fired: number; perDay: number; // 直近24時間に頼んだ数（手で頼んだ分・頼み直した分も）と、1日の上限
  resumeAt: string | null; // 1日の上限に達しているとき、上限が空く日時（ISO）。作業中の枠や設定で、そのあとも頼めないことがある
  waiting: number; // 頼む順番を待っている開発待ち（まだ頼んでいない・頼み直しが残っている）
  next: { projectId: number; title: string } | null; // 次に頼む開発待ち
};
export function toolRoutineStatus(now = Date.now()): ToolRoutineStatus {
  const s = getSettings();
  const off = !s.toolRoutineAuto ? "設定の「開発待ちのツールを自動でルーティンに頼む」がオフ" : s.killSwitch ? "緊急停止中" : !toolRoutineConfigured() ? "ツールを作るルーティンにつながっていない"
    : s.toolRoutinePerDay <= 0 ? "設定の「1日（24時間）に頼む数」が0" : s.toolRoutineConcurrent <= 0 ? "設定の「同時に頼む数」が0" : null;
  const rows = db().prepare("SELECT a.*, p.title AS project_title FROM approvals a JOIN projects p ON p.id = a.project_id WHERE a.kind = 'dev' AND p.demo = 0 AND a.status = 'pending' ORDER BY a.id").all() as (ApprovalRow & { project_title: string })[];
  const inFlight = rows.filter((a) => working(a, now));
  const queue = routineQueue(rows, now);
  const fired = firedSince(now);
  // 上限に達しているときは、数に入っているうちで、上限を超えた分だけ古いものが24時間を過ぎた時刻から、次を頼める
  const resumeAt = s.toolRoutinePerDay > 0 && fired.length >= s.toolRoutinePerDay ? new Date(atMs(fired[fired.length - s.toolRoutinePerDay]) + DAY_MS).toISOString() : null;
  return {
    off,
    working: inFlight.map((a) => ({ projectId: a.project_id, title: a.project_title, at: a.routine_at! })),
    concurrent: s.toolRoutineConcurrent,
    fired: fired.length, perDay: s.toolRoutinePerDay, resumeAt,
    waiting: queue.length,
    next: queue[0] ? { projectId: queue[0].project_id, title: queue[0].project_title } : null,
  };
}

// AIが自動で進めている作業か（人の判断待ちではなく「AIの作業待ち」に出すもの。運営者が決めた）
// ルーティンに自動で頼む開発待ちのうち、まだ頼んでいない・作業中・頼み直しが残っているもの。頼み直しを使い切って入らなかったものは、人の判断待ち
export function autoWork(a: Pick<ApprovalRow, "kind" | "status" | "routine_at" | "routine_tries">, now = Date.now()): boolean {
  const s = getSettings();
  if (a.kind !== "dev" || a.status !== "pending" || !s.toolRoutineAuto || s.killSwitch || !toolRoutineConfigured()) return false;
  return working(a, now) || a.routine_tries < AUTO_TRIES;
}

// 開発待ちのカードに出す、ルーティンの様子
export function toolRoutineView(a: Pick<ApprovalRow, "status" | "routine_at" | "routine_url">, now = Date.now()): { configured: boolean; at: string | null; url: string | null; working: boolean; retryable: boolean } {
  return {
    configured: toolRoutineConfigured(), at: a.routine_at, url: a.routine_url, working: working(a, now),
    retryable: a.status === "pending" && (!a.routine_at || now - atMs(a.routine_at) >= RETRY_MS),
  };
}

// チェックで止まったツールを、ルーティンに直してもらう（運営者が決めた。設定「チェックで止まったツールを、ルーティンに直してもらう」）
// 公開の判断待ちを作る代わりに、指摘を「直す指示」にした開発待ちを作る（運営者への判断待ちの知らせは出さない。ルーティンが直すため）
// 同じ案件では7日に1回だけ（ルーティンが直しても問題が残ったら、これまでどおり運営者の判断待ちに出す）。動くツールの案件だけ
// 直したツールを入れると、いつもどおりチェック・紹介ページづくりに進む（紹介ページの指摘は、紹介ページを作り直すときに直る）
export const HELD_FIX_DAYS = 7;
export function heldToRoutine(projectId: number, issues: string[]): boolean {
  const s = getSettings();
  const p = getProject(projectId);
  if (!p || p.kind !== "tool" || !s.toolRoutineFixHeld || s.killSwitch || !toolRoutineConfigured() || !issues.length) return false;
  const recent = db().prepare(`SELECT 1 FROM approvals WHERE project_id = ? AND kind = 'dev' AND json_extract(payload, '$.heldFix') = 1 AND created_at >= datetime('now', ?)`).get(projectId, `-${HELD_FIX_DAYS} days`);
  if (recent) return false;
  if (db().prepare("SELECT 1 FROM approvals WHERE project_id = ? AND status = 'pending' AND kind = 'dev'").get(projectId)) return false;
  const instruction = `公開の前のチェックで、次の問題が残りました。ツールを直してください（「紹介ページ:」で始まるものは、ツールを入れたあとに紹介ページを作り直すときに直るので、ツールでは直さない）。\n${issues.map((x, i) => `${i + 1}. ${x}`).join("\n")}`; // 切らずに全文を残す（後ろの指摘が抜けると、直せずにまた止まる。PR #132 の ai-review の指摘）
  const design = lastDevDesign(projectId) ?? "（設計書はありません。今のツールを読み、直す指示に沿って直してください。ツールの目的は、案件の名前と、依頼文の作るときの決まりから読み取ります）";
  db().prepare("INSERT INTO approvals (project_id, kind, proposal, reason, payload, lp_version) VALUES (?, 'dev', ?, ?, ?, (SELECT lp_version FROM projects WHERE id = ?))").run(
    projectId, `「${p.title}」のツールを、チェックの指摘に沿って直す`,
    `公開の前のチェックで問題が残ったので、クラウドの Claude Code（ルーティン）に直してもらいます。直したら、もう一度チェックします（ルーティンに頼むのは${HELD_FIX_DAYS}日に1回だけ。それでも問題が残れば、公開の判断待ちに出します）。手元の Claude Code で直して入れてもかまいません。`,
    JSON.stringify({ design, instruction, heldFix: true }), projectId,
  );
  logEvent(projectId, "system", "held-to-routine", `チェックで問題が残ったため、公開の判断待ちにせず、クラウドの Claude Code（ルーティン）に直してもらうことにしました: ${issues.join(" / ").slice(0, 200)}`);
  return true;
}

// いまルーティンが作業中の開発待ち（頼んでから3時間以内で、まだ入っていないもの）。本番の「作業中」（/api/live の building）に出す
// ルーティンはクラウドで動くので、ダッシュボードの中の作業中の印には出ない。マージの前に「本番が止まっているか」を見るとき、
// これを見ないと、作業中のルーティンがツールを入れた直後に本番が入れ替わり、取り込みが途中で止まる（#131 のマージで #65 が止まった）
export function routinesWorking(now = Date.now()): { id: number; what: string; since: number }[] {
  const rows = db().prepare("SELECT a.project_id, a.routine_at FROM approvals a JOIN projects p ON p.id = a.project_id WHERE a.kind = 'dev' AND a.status = 'pending' AND a.routine_at IS NOT NULL AND p.demo = 0 ORDER BY a.id").all() as { project_id: number; routine_at: string }[];
  return rows.filter((r) => now - atMs(r.routine_at) < ROUTINE_WORK_MS)
    .map((r) => ({ id: r.project_id, what: "クラウドの Claude Code（ルーティン）でツールを作っています", since: atMs(r.routine_at) }));
}
