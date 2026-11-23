// ダッシュボードの自動の戻しの決まり（scripts/auto-revert.ts から使う。GitHub を呼ばない、確かめやすい部分だけ）
// 運営者が決めた形:
// - マージして本番に出した直後に、本番の確認（smoke.yml）が2回続けて失敗し、その前の版では成功していたときだけ、
//   いちばん新しいマージを元に戻す PR を作って、CI が通ったらマージする
// - 1日1回まで。戻したら Discord に知らせる。戻しても直らなければ、それ以上は戻さずに人に回す
// - main に直接 push はしない（戻すのも PR で）

export type SmokeRun = { conclusion: string | null; head_sha: string; head_branch?: string | null; event?: string };

// 本番の確認の結果のうち、main の本番のものだけ（定期の回・main で手で動かした回は head_branch が main。本番に出したときの回は deployment_status）
// ほかのブランチで手で動かした回などを混ぜない（PR #166 の ai-review の指摘）。取り消し・飛ばしは結果ではないので除く
export const mainSmokeRuns = (runs: SmokeRun[]) =>
  runs.filter((x) => (x.head_branch === "main" || x.event === "deployment_status") && x.conclusion && x.conclusion !== "skipped" && x.conclusion !== "cancelled");
export type MainTip = { sha: string; parents: string[]; message: string };

export const REVERT_BRANCH = /^auto-revert\//;
export const revertBranch = (sha: string) => `auto-revert/${sha.slice(0, 12)}`;

export type RevertDecision =
  | { action: "revert"; merge: string; pr: number | null; reason: string }
  | { action: "human"; reason: string }
  | { action: "none"; reason: string };

// runs: main の本番の確認の結果（新しい順。取り消し・飛ばしは除いたもの）。tip: main のいちばん新しいコミット
// revertedToday: この24時間に、自動の戻しの PR を作ったか
export function decideRevert(x: { runs: SmokeRun[]; tip: MainTip; revertedToday: boolean }): RevertDecision {
  const [a, b, c] = x.runs;
  // 2回続けて失敗したときに1回だけ決める（3回目からは、もう決めたので何もしない。知らせ続けないように）
  if (!a || !b || a.conclusion !== "failure" || b.conclusion !== "failure") return { action: "none", reason: "本番の確認が2回続けて失敗していない" };
  // 戻した版のあとも失敗が続くなら、それ以上は戻さずに人に回す（戻した版で2回続けて失敗したときに1回だけ）
  if (/^Merge pull request #\d+ from [^/\s]+\/auto-revert\//.test(x.tip.message)) {
    const firstTime = a.head_sha === x.tip.sha && b.head_sha === x.tip.sha && (!c || c.head_sha !== x.tip.sha);
    return firstTime ? { action: "human", reason: "自動で元に戻したあとも、本番の確認が2回続けて失敗している" } : { action: "none", reason: "戻したあとの失敗は、もう知らせた" };
  }
  // 同じ版で失敗が3回以上続いているなら、2回目のときにもう決めた。3回前が別の版の失敗なら、ここが最初の判断の機会（PR #166 の ai-review の指摘）
  if (c && c.conclusion === "failure" && a.head_sha === b.head_sha && b.head_sha === c.head_sha) return { action: "none", reason: "2回続けて失敗したときに、もう決めた" };
  // 失敗した2回が、どちらも main のいちばん新しい版のものか（古い版の失敗では戻さない）
  if (a.head_sha !== x.tip.sha || b.head_sha !== x.tip.sha) return { action: "human", reason: "失敗した本番の確認が、main のいちばん新しい版のものではない" };
  // いちばん新しい版が、PR のマージか（マージでないコミットは戻さない）
  const m = x.tip.message.match(/^Merge pull request #(\d+) /);
  if (x.tip.parents.length !== 2 || !m) return { action: "human", reason: "main のいちばん新しい版が PR のマージではない" };
  // その前の版（マージの1つ目の親）で、本番の確認が成功していたか。ほかの版や、同じ版での成功なら、コードのせいとは言えないので戻さない
  if (!c || c.conclusion !== "success") return { action: "human", reason: "その前の本番の確認が成功していない（いつから失敗しているか分からない）" };
  if (c.head_sha === x.tip.sha) return { action: "human", reason: "同じ版で前は成功していた（コードではなく、本番の側の問題かもしれない）" };
  if (c.head_sha !== x.tip.parents[0]) return { action: "human", reason: "成功していた版が、いちばん新しいマージの直前の版ではない（あいだに別の変更がある）" };
  if (x.revertedToday) return { action: "human", reason: "この24時間に、もう自動で1回元に戻している" };
  return { action: "revert", merge: x.tip.sha, pr: Number(m[1]), reason: `マージ（PR #${m[1]}）のあと、本番の確認が2回続けて失敗し、その前の版では成功していた` };
}
