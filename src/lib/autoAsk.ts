import { aiFixConfigured, aiFixSending, aiFixSyncOk, startAiFix } from "./aiFix";
import { GROWTH_SCENE, REVIEW_SCENE } from "./codeReview";
import { db, getSettings } from "./db";
import { logEvent } from "./loop";
import type { Fetch } from "./routine";

// コードの見直しの提案を、運営者が押さなくても、自動で提案箱のルーティンに頼む（運営者が決めた。人の出番を減らす4つ目）
// - 守り（直すべき所）: 入ってから1日たったら頼む（その間に運営者が見送れば頼まない）。1日に1件まで
// - 攻め（足すとよい機能）: 定例会議で3社が採点し、平均7点以上のものだけ、点の高い順に頼む。3日に1件まで（見直しが週2回なので、それに合わせた）
// - ほかの提案（AIの社員・会議・エラーの見張りなどから入ったもの）: 定例会議で3社が採点し、平均7点以上のものだけ、点の高い順に頼む。
//   運営者が書いた提案は、入ってから1日たったら頼む（その間に運営者が見送れば頼まない）。合わせて1日に1件まで（運営者が「提案箱のやつは基本自動で良い」と決めた）
//   頼まれたルーティンが「直さなくて良い」と判断したら、見送りにする（/api/code-review/skip。docs/routine-proposal-fix.md）
// - 一度に頼むのは1件だけ（前に頼んだ PR がまだ開いている・PR ができていない間は頼まない）
// - できた PR は、自動マージ（scripts/auto-merge.ts）が、CI と GPT・Gemini のレビューを見てマージする
// - 設定の「提案箱の提案を自動で頼む」で切れる。緊急停止の間・PR の状態の読み直しに失敗している間は頼まない
export const GROWTH_MIN_SCORE = 7;
const WAIT = "-1 day";

type Row = { id: number; title: string; scene: string; score: number | null; source?: string };
export type AutoKind = "auto-fix" | "auto-growth" | "auto-box";

// 次に自動で頼む提案（なければ null）と、その理由
export function nextAutoAsk(): { row: Row; why: string; kind: AutoKind } | null {
  // 頼んだ改善が進んでいる間は、次を頼まない（PR が開いている・頼んでから PR が見つかっていない）
  // 提案を見送ったあとも、PR が開いている間は数える（PR #154 の ai-review の指摘）。PR の状態は、開いている間は提案の返事に関係なく読み直す（aiFix.ts の syncAiFixPrs）
  const busy = db().prepare("SELECT 1 FROM plan_requests WHERE ai_fix_at IS NOT NULL AND (ai_fix_pr_state = 'open' OR (ai_fix_pr IS NULL AND ai_fix_at >= datetime('now', '-1 day')))").get();
  if (busy) return null;
  // 自動で頼んだ回数は、上書きされない記録（events の auto-ask-fix・auto-ask-growth）の種類で数える
  // （人が頼み直すと提案の欄は上書きされる。記録の文で見分けると、題の言葉で取り違える。PR #154 の ai-review の指摘）
  const asked = (kind: "fix" | "growth" | "box", days: number) => (db().prepare("SELECT COUNT(*) AS n FROM events WHERE kind = ? AND at >= datetime('now', ?)").get(`auto-ask-${kind}`, `-${days} days`) as { n: number }).n;
  if (asked("fix", 1) === 0) {
    const fix = db().prepare("SELECT id, title, scene, score FROM plan_requests WHERE source = 'review' AND scene = ? AND target = 'system' AND status = 'open' AND ai_fix_at IS NULL AND created_at <= datetime('now', ?) ORDER BY repeats DESC, id LIMIT 1").get(REVIEW_SCENE, WAIT) as Row | undefined;
    if (fix) return { row: fix, why: "自動: コードの見直しの守りの提案で、1日たっても見送られなかった", kind: "auto-fix" };
  }
  // 攻めは、3社の採点で決める（入ってからの待ちは付けない。PR #154 の ai-review の指摘）
  if (asked("growth", 3) === 0) {
    const grow = db().prepare("SELECT id, title, scene, score FROM plan_requests WHERE source = 'review' AND scene = ? AND target = 'system' AND status = 'open' AND ai_fix_at IS NULL AND score >= ? ORDER BY score DESC, id LIMIT 1").get(GROWTH_SCENE, GROWTH_MIN_SCORE) as Row | undefined;
    if (grow) return { row: grow, why: `自動: コードの見直しの攻めの提案で、定例会議で3社の平均${grow.score!.toFixed(1)}点`, kind: "auto-growth" };
  }
  // ほかの提案: AIが出したものは3社の採点で、運営者が書いたものは1日待って（点の高い順・古い順）
  if (asked("box", 1) === 0) {
    const box = db().prepare(`SELECT id, title, scene, score, source FROM plan_requests WHERE source != 'review' AND target = 'system' AND status = 'open' AND ai_fix_at IS NULL
      AND ((source != 'human' AND score >= ?) OR (source = 'human' AND created_at <= datetime('now', ?))) ORDER BY (source = 'human') DESC, score DESC, id LIMIT 1`).get(GROWTH_MIN_SCORE, WAIT) as Row | undefined;
    if (box) return { row: box, why: box.source === "human" ? "自動: 運営者が書いた提案で、1日たっても見送られなかった" : `自動: 提案箱の提案で、定例会議で3社の平均${box.score!.toFixed(1)}点`, kind: "auto-box" };
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
