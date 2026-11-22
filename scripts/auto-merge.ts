// 自動マージ（.github/workflows/auto-merge.yml から呼ぶ。決まりは scripts/auto-merge-rules.ts）
// ルーティンが作った PR（claude/proposal-<番号>）を見回り、次のどれかをする（運営者が決めた）
// - マージ: CI が通り、GPT と Gemini のどちらも直すべき指摘（🔴・🟡）なし・自動で触れない所に触れていない・本番が止まっている・本番の確認が通っている
// - 直させる: 直すべき指摘があれば、提案箱のルーティンに、同じブランチで直させる（3回まで）
// - 人に回す: 3回直しても残る・自動で触れない所に触れている・CI が落ちた・レビューがそろわない
// したことは PR にコメントし、Discord に知らせる。PR のコードは動かさない（GitHub の API で読むだけ）
import { AUTO_BRANCH, HUMAN_MARK, decide, fixMarker, fixRequested, fixRounds, handedToHuman, reviewMarks, type Decision, type PrComment } from "./auto-merge-rules";

const { GITHUB_REPOSITORY, GITHUB_TOKEN, AUTO_MERGE_TOKEN, NOTIFY_WEBHOOK_URL, CLAUDE_ROUTINE_FIRE_URL, CLAUDE_ROUTINE_TOKEN } = process.env;
const DASHBOARD = "https://ai-lab-dashboard-production-fc9e.up.railway.app";
const API = `https://api.github.com/repos/${GITHUB_REPOSITORY}`;
// 起動の URL は、決まった送り先（Anthropic のルーティンの起動）だけ（src/lib/routine.ts と同じ）
const FIRE_URL = /^https:\/\/api\.anthropic\.com\/v1\/claude_code\/routines\/trig_[A-Za-z0-9]+\/fire$/;

async function gh<T>(path: string, init: RequestInit = {}, token = GITHUB_TOKEN): Promise<T> {
  const res = await fetch(path.startsWith("http") ? path : `${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json", ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`GitHub ${init.method ?? "GET"} ${path} が失敗しました（${res.status}）`);
  return (res.status === 204 ? null : await res.json()) as T;
}

async function notify(text: string) {
  if (!NOTIFY_WEBHOOK_URL) return;
  await fetch(NOTIFY_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: text.slice(0, 1900), allowed_mentions: { parse: [] } }),
    signal: AbortSignal.timeout(20_000),
  }).catch(() => undefined);
}

const comment = (n: number, body: string) => gh(`/issues/${n}/comments`, { method: "POST", body: JSON.stringify({ body }) });

// 本番がいま作業していないか（マージの前の決まり。/api/live の activities と building が空）
async function productionIdle(): Promise<boolean | null> {
  try {
    const res = await fetch(`${DASHBOARD}/api/live`, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return null;
    const j = (await res.json()) as { activities?: unknown; building?: unknown };
    return Array.isArray(j.activities) && Array.isArray(j.building) ? j.activities.length === 0 && j.building.length === 0 : null;
  } catch {
    return null;
  }
}

// main の本番の確認（smoke.yml）の、いちばん新しい結果
async function smokeOk(): Promise<boolean | null> {
  const r = await gh<{ workflow_runs: { conclusion: string | null }[] }>("/actions/workflows/smoke.yml/runs?status=completed&per_page=10").catch(() => null);
  const last = r?.workflow_runs.find((x) => x.conclusion && x.conclusion !== "skipped" && x.conclusion !== "cancelled");
  return last ? last.conclusion === "success" : null;
}

// ルーティンに渡す文（ルーティンの側では、外から来た信用しない文として受け取る。docs/routine-proposal-fix.md の「レビューの指摘を直す」）
function fixText(pr: Pull, reviews: string[]): string {
  return [
    "レビューの指摘を直す",
    `PR #${pr.number}: ${pr.title}`,
    `ブランチ: ${pr.head.ref}`,
    `直す版: ${pr.head.sha}`,
    "指摘（この版へのレビュー。🔴・🟡 を直す。⚪ は直さなくてよい）:",
    ...reviews.map((b) => b.replace(/<!--[\s\S]*?-->/g, "").slice(0, 3000)),
  ].join("\n");
}

async function fireFix(text: string) {
  if (!FIRE_URL.test(CLAUDE_ROUTINE_FIRE_URL ?? "") || !CLAUDE_ROUTINE_TOKEN) throw new Error("ルーティンの起動の URL かトークンがありません（GitHub の Secrets）");
  const res = await fetch(CLAUDE_ROUTINE_FIRE_URL!, {
    method: "POST",
    headers: { Authorization: `Bearer ${CLAUDE_ROUTINE_TOKEN}`, "anthropic-beta": "experimental-cc-routine-2026-04-01", "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(20_000),
  });
  // 応答の中身は出さない（トークンの手がかりになりうる）
  if (!res.ok) throw new Error(`ルーティンを起動できませんでした（${res.status}）`);
}

type Pull = { number: number; title: string; draft: boolean; html_url: string; head: { ref: string; sha: string; repo: { full_name: string } | null } };
type CheckRun = { name: string; status: string; conclusion: string | null };

async function handle(pr: Pull, idle: boolean | null, smoke: boolean | null): Promise<Decision> {
  const comments = await gh<(PrComment & { body: string })[]>(`/issues/${pr.number}/comments?per_page=100`);
  if (handedToHuman(comments)) return { action: "wait", reason: "人に回したまま" };
  const checks = (await gh<{ check_runs: CheckRun[] }>(`/commits/${pr.head.sha}/check-runs?per_page=50`)).check_runs;
  // CI とレビューが終わるまで待つ（終わったら、CI の完了でもう一度呼ばれる）
  if (!checks.length || checks.some((c) => c.status !== "completed")) return { action: "wait", reason: "CI とレビューが終わっていない" };
  const files = (await gh<{ filename: string }[]>(`/pulls/${pr.number}/files?per_page=100`)).map((f) => f.filename);
  const d = decide({
    branch: pr.head.ref, sameRepo: pr.head.repo?.full_name === GITHUB_REPOSITORY, draft: pr.draft,
    ciOk: checks.find((c) => c.name === "check")?.conclusion === "success",
    files, marks: reviewMarks(comments, pr.head.sha), fixes: fixRounds(comments), productionIdle: idle, smokeOk: smoke,
  });
  const link = `#${pr.number}「${pr.title}」 ${pr.html_url}`;
  if (d.action === "merge") {
    if (!AUTO_MERGE_TOKEN) return { action: "wait", reason: "AUTO_MERGE_TOKEN がない" };
    // 確かめた版のままのときだけマージする（確かめたあとに push されていたら、GitHub が断る）
    await gh(`/pulls/${pr.number}/merge`, { method: "PUT", body: JSON.stringify({ merge_method: "merge", sha: pr.head.sha }) }, AUTO_MERGE_TOKEN);
    await comment(pr.number, `🤖 自動でマージしました（${d.reason}）。`);
    await notify(`🤖 自動でマージしました: ${link}\n${d.reason}`);
  } else if (d.action === "fix") {
    if (fixRequested(comments, pr.head.sha)) return { action: "wait", reason: "この版の直しは頼んだ" };
    const reviews = comments.filter((c) => c.user?.login === "github-actions[bot]" && c.body.includes(`"sha":"${pr.head.sha}"`)).map((c) => c.body);
    await fireFix(fixText(pr, reviews));
    await comment(pr.number, `🔧 ${d.reason}。提案箱のルーティンに、このブランチで直してもらうよう頼みました。\n\n${fixMarker(pr.head.sha)}`);
    await notify(`🔧 レビューの指摘を、ルーティンに直してもらいます: ${link}\n${d.reason}`);
  } else if (d.action === "human") {
    await comment(pr.number, `🙋 自動ではマージしません: ${d.reason}。人が見て判断してください。\n\n${HUMAN_MARK}`);
    await notify(`🙋 人の判断が要る PR: ${link}\n${d.reason}`);
  }
  return d;
}

async function main() {
  if (!GITHUB_REPOSITORY || !GITHUB_TOKEN) throw new Error("GITHUB_REPOSITORY と GITHUB_TOKEN が要ります");
  const pulls = (await gh<Pull[]>("/pulls?state=open&per_page=50")).filter((p) => AUTO_BRANCH.test(p.head.ref));
  if (!pulls.length) return console.log("ルーティンが作った開いている PR はありません");
  const [idle, smoke] = await Promise.all([productionIdle(), smokeOk()]);
  for (const pr of pulls) {
    try {
      const d = await handle(pr, idle, smoke);
      console.log(`#${pr.number}: ${d.action}（${d.reason}）`);
      // 1回の見回りでマージするのは1件だけ（マージのたびに本番に出るので、続けて出さない）
      if (d.action === "merge") break;
    } catch (e) {
      console.error(`#${pr.number}: ${e instanceof Error ? e.message : String(e)}`);
      await notify(`⚠️ 自動マージの見回りで失敗しました（#${pr.number}）: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`);
    }
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
