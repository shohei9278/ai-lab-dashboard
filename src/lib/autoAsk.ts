import { aiFixConfigured, aiFixSending, aiFixSyncOk, startAiFix } from "./aiFix";
import { GROWTH_SCENE, REVIEW_SCENE } from "./codeReview";
import { db, getSettings } from "./db";
import { logEvent } from "./loop";
import type { Fetch } from "./routine";

// 提案箱の「仕組みの改善」を、運営者が押さなくても、自動でルーティンに頼む（運営者が決めた。人の出番を減らす4つ目と、その続き）
// - 一度に頼むのは1件だけ（前に頼んだ PR がまだ開いている・PR ができていない間は頼まない）。終わったら、次の見回り（1時間に1回）で次を頼む
// - 全部合わせて1日（24時間）に DAILY_MAX 件まで（暴走したときの歯止め。種類ごとの上限はやめた。運営者が「1日1件だと遅い」と言い、決めた）
// - 頼む順:
//   1. コードの見直しの守り（直すべき所）: 入ってから1日たっても見送られなければ（その間に運営者が見送れば頼まない）
//   2. 運営者が書いた提案: 入ってから1時間たっても見送られなければ（書いてすぐ頼まれると、取り消す間がないため）
//   3. 3社の採点の平均が7点以上の提案（見直しの攻め・AIの社員・会議・エラーの見張りなど）: 点の高い順・入った日時の古い順
// - 頼まれたルーティンが「直さなくて良い」と判断したら、見送りにする（/api/code-review/skip。docs/routine-proposal-fix.md）
// - できた PR は、自動マージ（scripts/auto-merge.ts）が、CI と GPT・Gemini のレビューを見てマージする
// - 設定の「提案箱の提案を自動で頼む」で切れる。緊急停止の間・PR の状態の読み直しに失敗している間は頼まない
export const GROWTH_MIN_SCORE = 7;
export const DAILY_MAX = 4;
const FIX_WAIT = "-1 day";
const HUMAN_WAIT = "-1 hour";

type Row = { id: number; title: string; scene: string; score: number | null; source?: string };
export type AutoKind = "auto-fix" | "auto-growth" | "auto-box";

// 次に自動で頼む提案（なければ null）と、その理由
export function nextAutoAsk(): { row: Row; why: string; kind: AutoKind } | null {
  // 頼んだ改善が進んでいる間は、次を頼まない（PR が開いている・頼んでから PR が見つかっていない）
  // 提案を見送ったあとも、PR が開いている間は数える（PR #154 の ai-review の指摘）。PR の状態は、開いている間は提案の返事に関係なく読み直す（aiFix.ts の syncAiFixPrs）
  // PR がまだないものは、返事待ちの間だけ数える（ルーティンが見送ったら、すぐ次を頼めるように。PR #155 の ai-review の指摘）
  const busy = db().prepare("SELECT 1 FROM plan_requests WHERE ai_fix_at IS NOT NULL AND (ai_fix_pr_state = 'open' OR (status = 'open' AND ai_fix_pr IS NULL AND ai_fix_at >= datetime('now', '-1 day')))").get();
  if (busy) return null;
  // 自動で頼んだ回数は、上書きされない記録（events の auto-ask-fix・auto-ask-growth・auto-ask-box）で数える
  // （人が頼み直すと提案の欄は上書きされる。記録の文で見分けると、題の言葉で取り違える。PR #154 の ai-review の指摘）
  const asked = (db().prepare("SELECT COUNT(*) AS n FROM events WHERE kind IN ('auto-ask-fix', 'auto-ask-growth', 'auto-ask-box') AND at >= datetime('now', '-1 day')").get() as { n: number }).n;
  if (asked >= DAILY_MAX) return null;
  const open = "target = 'system' AND status = 'open' AND ai_fix_at IS NULL";
  const fix = db().prepare(`SELECT id, title, scene, score FROM plan_requests WHERE source = 'review' AND scene = ? AND ${open} AND created_at <= datetime('now', ?) ORDER BY repeats DESC, created_at, id LIMIT 1`).get(REVIEW_SCENE, FIX_WAIT) as Row | undefined;
  if (fix) return { row: fix, why: "自動: コードの見直しの守りの提案で、1日たっても見送られなかった", kind: "auto-fix" };
  const human = db().prepare(`SELECT id, title, scene, score FROM plan_requests WHERE source = 'human' AND ${open} AND created_at <= datetime('now', ?) ORDER BY created_at, id LIMIT 1`).get(HUMAN_WAIT) as Row | undefined;
  if (human) return { row: human, why: "自動: 運営者が書いた提案で、1時間たっても見送られなかった", kind: "auto-box" };
  // 採点で決めるもの（見直しの攻め・AIの社員・会議など）。見直しの守りは、採点されても上の待ちで頼む
  const scored = db().prepare(`SELECT id, title, scene, score, source FROM plan_requests WHERE source != 'human' AND NOT (source = 'review' AND scene = ?) AND ${open} AND score >= ? ORDER BY score DESC, created_at, id LIMIT 1`).get(REVIEW_SCENE, GROWTH_MIN_SCORE) as Row | undefined;
  if (scored) {
    const growth = scored.source === "review" && scored.scene === GROWTH_SCENE;
    return { row: scored, why: `自動: ${growth ? "コードの見直しの攻めの提案" : "提案箱の提案"}で、定例会議で3社の平均${scored.score!.toFixed(1)}点`, kind: growth ? "auto-growth" : "auto-box" };
  }
  return null;
}

// 定期の処理から呼ぶ（1時間に1回）。頼んだら true
const g = globalThis as unknown as { __aiLabAutoAskAt?: number };
export async function maybeAutoAsk(fetchImpl: Fetch = fetch, force = false): Promise<boolean> {
  if (!force && g.__aiLabAutoAskAt && Date.now() - g.__aiLabAutoAskAt < 3_600_000) return false;
  // 人の依頼を送っている途中なら、今回は見送る（次の見回りで、その依頼を数えて決める）
  if (aiFixSending()) return false;
  // PR の状態の読み直しに失敗している間は頼まない（GitHub にある PR を数えそこねて、2件目を頼まないように。PR #154 の ai-review の指摘）
  if (!aiFixSyncOk()) return false;
  g.__aiLabAutoAskAt = Date.now();
  const s = getSettings();
  if (!s.autoAskReview || s.killSwitch || !aiFixConfigured()) return false;
  const next = nextAutoAsk();
  if (!next) return false;
  try {
    await startAiFix(next.row.id, next.why, fetchImpl, next.kind);
    return true;
  } catch (e) {
    logEvent(null, "system", "auto-ask-error", `提案箱の「${next.row.title}」を自動で頼めませんでした: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`);
    return false;
  }
}
