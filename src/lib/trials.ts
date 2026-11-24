import { db } from "./db";
import { jstDateTime } from "./format";
import { logEvent } from "./loop";
import { modelInfo } from "./models";
import { jstDay } from "./sns";

// 試し: 朝会が決める「何を変えて、いつ・何の数字で判断するか」（運営者が決めた）
// - 投稿から1日では訪問がほとんどないので、翌朝のAIが少ない数字で勝ち負けを決めがちだった。判定日時と、判断に要る訪問の下限を先に決める
// - 判定日時が来るまでは結論を出さない（朝会の材料でも「まだ判断しない」と渡す）
// - 判定日時に訪問が下限に届いていなければ、判断を保留して1回だけ延ばす。延ばしても届かなければ「判断できなかった」で閉じる
// - focus: 新しい案件づくりを休んで、すでに利用が出た公開中の案件の紹介の仕方を変えて比べるもの（既存のツールの集客の実験）

export type TrialMetric = "visits" | "conversions";
export type TrialRow = {
  id: number; plan_id: number; project_id: number; created_at: string; question: string; change: string; metric: TrialMetric;
  judge_at: string; hours: number; min_visits: number; focus: number; extended: number; status: "open" | "decided" | "expired";
  verdict: "win" | "lose" | "unclear" | null; result: string | null; decided_at: string | null; decided_by: string | null;
  final_visits: number | null; final_conversions: number | null;
};
export const TRIAL_MAX_OPEN = 3; // 同時に試すのは3件まで（多いと、どれも数字が足りなくなる）
export const TRIAL_MAX_NEW = 2; // 1回の朝会で始めるのは2件まで
export const TRIAL_HOURS = { min: 24, max: 168 };
export const TRIAL_MIN_VISITS = { min: 5, max: 200, default: 20 };
export const VERDICT_LABEL: Record<NonNullable<TrialRow["verdict"]>, string> = { win: "効いた", lose: "効かなかった", unclear: "はっきりしない" };
export const METRIC_LABEL: Record<TrialMetric, string> = { visits: "訪問", conversions: "登録・利用" };

const utc = (ms: number) => new Date(ms).toISOString().replace("T", " ").slice(0, 19);
const ms = (s: string) => Date.parse(`${s.replace(" ", "T")}Z`);
const clamp = (v: unknown, lo: number, hi: number, d: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};

export function openTrials(): TrialRow[] {
  return db().prepare("SELECT * FROM plan_trials WHERE status = 'open' ORDER BY id").all() as TrialRow[];
}
export function listTrials(limit = 20): (TrialRow & { title: string })[] {
  return db().prepare("SELECT t.*, p.title FROM plan_trials t JOIN projects p ON p.id = t.project_id ORDER BY (t.status = 'open') DESC, t.id DESC LIMIT ?").all(limit) as (TrialRow & { title: string })[];
}

// 試しを始めてからの数字（訪問・登録/利用は日ごとの集計なので、始めた日の分も入る）と、そのあいだの宣伝の投稿ごとの数字
export function trialStats(t: Pick<TrialRow, "project_id" | "created_at">): { visits: number; conversions: number; posts: { platform: string; angle: string; visits: number; conversions: number }[] } {
  const from = jstDay(new Date(ms(t.created_at)));
  const m = db().prepare("SELECT COALESCE(SUM(visits), 0) AS v, COALESCE(SUM(signups), 0) AS c FROM metrics WHERE project_id = ? AND day >= ? AND source != 'simulated'").get(t.project_id, from) as { v: number; c: number };
  const posts = db().prepare("SELECT platform, COALESCE(angle, substr(text, 1, 30)) AS angle, COALESCE(visits, 0) AS visits, COALESCE(conversions, 0) AS conversions FROM sns_posts WHERE project_id = ? AND status = 'posted' AND posted_at >= ? ORDER BY id")
    .all(t.project_id, t.created_at) as { platform: string; angle: string; visits: number; conversions: number }[];
  return { visits: m.v, conversions: m.c, posts };
}

// 朝会が出した試しを入れる（決まりに合わないものは入れない）。入れた件数を返す
// focusOk: その朝会のネックが reach / use で、新しい案件を休む（pause_new）とき。そろわなければ、印のある試しもふつうの試しにする（PR #172 の ai-review の指摘）
export function addTrials(planId: number, raw: unknown, opts: { live: Set<number>; model: string; now?: number; focusOk?: boolean }): number {
  if (!Array.isArray(raw)) return 0;
  const now = opts.now ?? Date.now();
  let room = Math.min(TRIAL_MAX_NEW, TRIAL_MAX_OPEN - openTrials().length);
  let n = 0;
  const ins = db().prepare("INSERT INTO plan_trials (plan_id, project_id, created_at, question, change, metric, judge_at, hours, min_visits, focus) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  for (const x of raw) {
    if (room <= 0) break;
    if (!x || typeof x !== "object") continue;
    const t = x as Record<string, unknown>;
    const pid = Number(t.project_id);
    const question = typeof t.question === "string" ? t.question.trim() : "";
    const change = typeof t.change === "string" ? t.change.trim() : "";
    if (!opts.live.has(pid) || !question || !change) continue;
    // 同じ案件で、まだ判定日時を待っている試しがあれば重ねない（どちらの効果か分からなくなるため）
    if (db().prepare("SELECT 1 FROM plan_trials WHERE project_id = ? AND status = 'open'").get(pid)) continue;
    const metric: TrialMetric = t.metric === "conversions" ? "conversions" : "visits";
    const hours = clamp(t.judge_after_hours, TRIAL_HOURS.min, TRIAL_HOURS.max, 48);
    const minVisits = clamp(t.min_visits, TRIAL_MIN_VISITS.min, TRIAL_MIN_VISITS.max, TRIAL_MIN_VISITS.default);
    // 既存の案件の集客の実験は、すでに登録・利用が出た案件だけ（利用が0の案件では、紹介の仕方の差が見えないため）
    const used = (db().prepare("SELECT COALESCE(SUM(signups), 0) AS c FROM metrics WHERE project_id = ? AND source != 'simulated'").get(pid) as { c: number }).c;
    const focus = t.focus === true && opts.focusOk === true && used > 0 ? 1 : 0;
    ins.run(planId, pid, utc(now), question.slice(0, 200), change.slice(0, 300), metric, utc(now + hours * 3_600_000), hours, minVisits, focus);
    logEvent(pid, "ai", "trial", `試しを始めました（${modelInfo(opts.model).label}）: ${question.slice(0, 80)}。${hours}時間後に${METRIC_LABEL[metric]}で判断します（訪問${minVisits}人に届かなければ保留）${focus ? "。新しい案件を休んで、この案件の集客を試します" : ""}`);
    room--;
    n++;
  }
  return n;
}

// 判定日時が来た試しを見る。訪問が下限に届いていなければ、1回だけ延ばす（届かなければ「判断できなかった」で閉じる）
// 残ったもの（判定日時が来て、数字がそろったもの）を返す。朝会のAIが結論を出す
export function settleDueTrials(now = Date.now()): TrialRow[] {
  const due: TrialRow[] = [];
  for (const t of openTrials()) {
    if (ms(t.judge_at) > now) continue;
    const s = trialStats(t);
    if (s.visits >= t.min_visits) {
      due.push(t);
      continue;
    }
    if (!t.extended) {
      const next = utc(ms(t.judge_at) + t.hours * 3_600_000);
      db().prepare("UPDATE plan_trials SET judge_at = ?, extended = 1 WHERE id = ?").run(next, t.id);
      logEvent(t.project_id, "system", "trial", `試し「${t.question.slice(0, 60)}」は、訪問が${s.visits}人で下限（${t.min_visits}人）に届かないので、判断を保留して${jstDateTime(next)}まで延ばしました`);
    } else {
      db().prepare("UPDATE plan_trials SET status = 'expired', result = ?, decided_at = datetime('now'), final_visits = ?, final_conversions = ? WHERE id = ?")
        .run(`延ばしても訪問が${s.visits}人で、下限（${t.min_visits}人）に届かなかったので、判断できなかった`, s.visits, s.conversions, t.id);
      logEvent(t.project_id, "system", "trial", `試し「${t.question.slice(0, 60)}」は、延ばしても訪問が下限に届かなかったので、判断せずに閉じました（訪問${s.visits}人）`);
    }
  }
  return due;
}

// 朝会が出した、判定日時が来た試しの結論を入れる（判定日時が来ていない試し・知らない番号の結論は入れない）
export function applyTrialResults(raw: unknown, due: TrialRow[], model: string): number {
  if (!Array.isArray(raw)) return 0;
  const ids = new Set(due.map((t) => t.id));
  let n = 0;
  for (const x of raw) {
    if (!x || typeof x !== "object") continue;
    const r = x as Record<string, unknown>;
    const id = Number(r.id);
    const verdict = r.verdict === "win" || r.verdict === "lose" || r.verdict === "unclear" ? r.verdict : null;
    const result = typeof r.result === "string" ? r.result.trim() : "";
    if (!ids.has(id) || !verdict || !result) continue;
    const t = due.find((d) => d.id === id)!;
    const s = trialStats(t);
    db().prepare("UPDATE plan_trials SET status = 'decided', verdict = ?, result = ?, decided_at = datetime('now'), decided_by = ?, final_visits = ?, final_conversions = ? WHERE id = ? AND status = 'open'")
      .run(verdict, result.slice(0, 400), model, s.visits, s.conversions, id);
    logEvent(t.project_id, "ai", "trial", `試し「${t.question.slice(0, 60)}」の結論（${modelInfo(model).label}）: ${VERDICT_LABEL[verdict]}。${result.slice(0, 160)}`);
    ids.delete(id);
    n++;
  }
  return n;
}

// 朝会の材料: 判定日時が来た試し（結論を出す）・まだの試し（結論を出さない）・最近終わった試し
export function trialsText(due: TrialRow[], now = Date.now()): string {
  const title = (pid: number) => (db().prepare("SELECT title FROM projects WHERE id = ?").get(pid) as { title: string } | undefined)?.title ?? `#${pid}`;
  const line = (t: TrialRow) => {
    const s = trialStats(t);
    const posts = s.posts.map((p) => `${p.platform}「${p.angle.slice(0, 30)}」訪問${p.visits}・成果${p.conversions}`).join(" / ");
    return `【${t.id}】#${t.project_id} ${title(t.project_id)}: ${t.question}（変えたこと: ${t.change}・見る数字: ${METRIC_LABEL[t.metric]}・判定 ${jstDateTime(t.judge_at)}${t.extended ? "（延長済み）" : ""}・下限 訪問${t.min_visits}人）今の数字: 訪問${s.visits}・登録/利用${s.conversions}${posts ? `／この間の投稿: ${posts}` : ""}`;
  };
  const waiting = openTrials().filter((t) => ms(t.judge_at) > now);
  const done = db().prepare("SELECT * FROM plan_trials WHERE status != 'open' ORDER BY id DESC LIMIT 5").all() as TrialRow[];
  return [
    `判定日時が来た試し（数字はそろっている。trial_results で、それぞれ win / lose / unclear と理由を必ず返す）:\n${due.map(line).join("\n") || "（なし）"}`,
    `判定日時が来ていない試し（まだ結論を出さない。この案件の数字だけで勝ち負けを決めず、振り返りでは「判断保留」と書く。同じ案件に新しい試しを重ねない）:\n${waiting.map(line).join("\n") || "（なし）"}`,
    `最近終わった試し:\n${done.map((t) => `- #${t.project_id} ${title(t.project_id)}: ${t.question} → ${t.verdict ? VERDICT_LABEL[t.verdict] : "判断できなかった"}（${t.result ?? ""}）`).join("\n") || "（なし）"}`,
  ].join("\n\n");
}
