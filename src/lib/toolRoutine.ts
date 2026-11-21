import crypto from "node:crypto";
import { db, getSettings, type ApprovalRow } from "./db";
import { getProject, logEvent } from "./loop";
import { atMs, fireRoutine, routineConfigured, type Fetch } from "./routine";

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

// ルーティンに渡す文（ルーティンの側では、外から来た信用しない文として受け取る）
export function toolRoutineText(a: ApprovalRow): string {
  const p = getProject(a.project_id)!;
  const payload = JSON.parse(a.payload ?? "{}") as { instruction?: string | null };
  return [
    `案件 #${p.id}「${p.title}」`,
    p.deep ? "じっくり案件" : "ふつうの案件",
    p.lp ? "直す（今のツールがある）" : "新しく作る",
    `開発待ちの番号: ${a.id}`,
    payload.instruction ? `直す指示: ${payload.instruction.slice(0, 1500)}` : "",
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
  const claimed = db().prepare(`UPDATE approvals SET routine_at = datetime(?, 'unixepoch'), routine_url = NULL
    WHERE id = ? AND kind = 'dev' AND status = 'pending' AND (routine_at IS NULL OR routine_at <= datetime(?, 'unixepoch'))`).run(stamp, approvalId, stamp - RETRY_MS / 1000).changes;
  if (!claimed) throw new Error("頼んだばかりです。1時間たってから、もう一度頼めます");
  let url: string | null;
  try {
    url = await fireRoutine(URL_VAR, TOKEN_VAR, toolRoutineText(a), opts.fetchImpl);
  } catch (e) {
    // 起動できなかったら、頼んだ記録を元に戻す
    db().prepare("UPDATE approvals SET routine_at = ?, routine_url = ? WHERE id = ?").run(a.routine_at, a.routine_url, approvalId);
    throw e;
  }
  db().prepare("UPDATE approvals SET routine_url = ? WHERE id = ?").run(url, approvalId);
  // 1日に頼んだ数は、この経過の数で数える（同じ開発待ちを頼み直した分も、1回ずつ数える）
  logEvent(a.project_id, opts.manual ? "human" : "system", "tool-routine", `ツールを${getProject(a.project_id)?.lp ? "直す" : "作る"}のを、クラウドの Claude Code（ルーティン）に頼みました${opts.manual ? "（運営者が頼んだ）" : ""}`);
  return url;
}

// 24時間以内にルーティンに頼んだ回数（手で頼んだ分・頼み直した分も、1回ずつ数える）
function firedSince(now: number): number {
  return (db().prepare("SELECT COUNT(*) AS n FROM events WHERE kind = 'tool-routine' AND at > datetime(?, 'unixepoch')").get(Math.floor((now - DAY_MS) / 1000)) as { n: number }).n;
}

// 開発待ちを、設定の数の範囲で自動で頼む（見回りのたびに見る）。頼んだ数を返す
// 同時に頼む数: 作業中（頼んで3時間以内でまだ入っていない）の数。1日に頼む数: 24時間以内に頼んだ回数（手で頼んだ分・頼み直した分も数える）
// 自動では、一度頼んだ開発待ちは頼み直さない（入らなかったら、運営者が見て頼み直す）
export async function autoToolRoutine(opts: { fetchImpl?: Fetch; now?: number } = {}): Promise<number> {
  const s = getSettings();
  if (!s.toolRoutineAuto || s.killSwitch || !toolRoutineConfigured()) return 0;
  const now = opts.now ?? Date.now();
  const rows = db().prepare("SELECT a.* FROM approvals a JOIN projects p ON p.id = a.project_id WHERE a.kind = 'dev' AND p.demo = 0 AND (a.status = 'pending' OR a.routine_at IS NOT NULL) ORDER BY a.id").all() as ApprovalRow[];
  const inFlight = rows.filter((a) => working(a, now)).length;
  const today = firedSince(now);
  let slots = Math.min(s.toolRoutineConcurrent - inFlight, s.toolRoutinePerDay - today);
  let n = 0;
  for (const a of rows.filter((x) => x.status === "pending" && !x.routine_at)) {
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

// 開発待ちのカードに出す、ルーティンの様子
export function toolRoutineView(a: Pick<ApprovalRow, "status" | "routine_at" | "routine_url">, now = Date.now()): { configured: boolean; at: string | null; url: string | null; working: boolean; retryable: boolean } {
  return {
    configured: toolRoutineConfigured(), at: a.routine_at, url: a.routine_url, working: working(a, now),
    retryable: a.status === "pending" && (!a.routine_at || now - atMs(a.routine_at) >= RETRY_MS),
  };
}
