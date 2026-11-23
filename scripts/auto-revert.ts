// ダッシュボードの自動の戻し（.github/workflows/auto-revert.yml から、本番の確認が失敗したときに、必ず main のコードで動く。決まりは scripts/auto-revert-rules.ts）
// マージして本番に出した直後に本番の確認が2回続けて失敗したら、いちばん新しいマージを元に戻す PR を作り、CI（check）が通ったらマージする（運営者が決めた）
// - main に直接 push はしない。元に戻す PR は、AUTO_MERGE_TOKEN で作ってマージする（main の CI が動き、Railway が前の版に戻した main を出す）
// - 1日1回まで。戻した・人に回したは Discord に知らせる
import { execFileSync } from "node:child_process";
import { REVERT_BRANCH, decideRevert, mainSmokeRuns, revertBranch, type MainTip, type SmokeRun } from "./auto-revert-rules";

const { GITHUB_REPOSITORY, GITHUB_TOKEN, AUTO_MERGE_TOKEN, NOTIFY_WEBHOOK_URL } = process.env;
const API = `https://api.github.com/repos/${GITHUB_REPOSITORY}`;
const CHECK_WAIT_MS = 20 * 60 * 1000;

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
  if (!NOTIFY_WEBHOOK_URL) return console.error(`Discord の送り先がないため、知らせていません: ${text.slice(0, 200)}`);
  const res = await fetch(NOTIFY_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: text.slice(0, 1900), allowed_mentions: { parse: [] } }),
    signal: AbortSignal.timeout(20_000),
  }).catch(() => null);
  if (!res?.ok) console.error(`Discord に知らせられませんでした（${res ? res.status : "通信の失敗"}）`);
}

const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" }).trim();
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

async function main() {
  if (!GITHUB_REPOSITORY || !GITHUB_TOKEN) throw new Error("GITHUB_REPOSITORY と GITHUB_TOKEN が要ります");
  // main の本番の確認の結果（新しい順。ほかのブランチの回・取り消し・飛ばしは除く）
  const r = await gh<{ workflow_runs: SmokeRun[] }>("/actions/workflows/smoke.yml/runs?status=completed&per_page=30");
  const runs = mainSmokeRuns(r.workflow_runs);
  git("fetch", "--quiet", "origin", "main");
  const sha = git("rev-parse", "origin/main");
  const tip: MainTip = { sha, parents: git("rev-list", "--parents", "-n", "1", sha).split(" ").slice(1), message: git("log", "-1", "--format=%B", sha) };
  // この24時間に、自動の戻しの PR を作ったか
  const since = Date.now() - 24 * 3600 * 1000;
  const pulls = await gh<{ head: { ref: string }; created_at: string }[]>("/pulls?state=all&per_page=50&sort=created&direction=desc");
  const revertedToday = pulls.some((p) => REVERT_BRANCH.test(p.head.ref) && Date.parse(p.created_at) >= since);

  const d = decideRevert({ runs, tip, revertedToday });
  console.log(`${d.action}: ${d.reason}`);
  if (d.action === "none") return;
  if (d.action === "human") return notify(`🙋 本番の確認が2回続けて失敗していますが、自動では元に戻しません: ${d.reason}。人が見て判断してください`);
  if (!AUTO_MERGE_TOKEN) return notify(`🙋 本番の確認が2回続けて失敗しています（${d.reason}）。AUTO_MERGE_TOKEN がないため、自動では元に戻せません`);

  // 元に戻すコミットを作り、専用のブランチに push する（main には直接 push しない）
  const branch = revertBranch(d.merge);
  git("config", "user.name", "github-actions[bot]");
  git("config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com");
  git("switch", "--quiet", "-c", branch, d.merge);
  git("revert", "--no-edit", "-m", "1", d.merge);
  // push の失敗の文には、トークンを含むコマンドが入るので、そのまま記録や知らせに出さない
  try {
    execFileSync("git", ["push", "--quiet", `https://x-access-token:${AUTO_MERGE_TOKEN}@github.com/${GITHUB_REPOSITORY}.git`, `HEAD:refs/heads/${branch}`], { stdio: "ignore" });
  } catch {
    throw new Error(`元に戻すブランチ（${branch}）を push できませんでした`);
  }
  const head = git("rev-parse", "HEAD");
  const pr = await gh<{ number: number; html_url: string }>("/pulls", {
    method: "POST",
    body: JSON.stringify({
      title: `自動の戻し: PR #${d.pr} を元に戻す（本番の確認が2回続けて失敗した）`,
      head: branch,
      base: "main",
      body: `${d.reason}ため、自動の戻し（scripts/auto-revert.ts）が、いちばん新しいマージ（${d.merge.slice(0, 7)}・PR #${d.pr}）を元に戻します。\n\nCI（check）が通ったら、自動でマージします。直したうえで出し直すときは、PR #${d.pr} の変更を、新しい PR で入れ直してください。`,
    }),
  }, AUTO_MERGE_TOKEN);

  // CI（check）が通るのを待ってからマージする（確かめた版のときだけ）
  const until = Date.now() + CHECK_WAIT_MS;
  let state = "pending";
  while (Date.now() < until) {
    await sleep(20_000);
    const checks = (await gh<{ check_runs: { name: string; status: string; conclusion: string | null }[] }>(`/commits/${head}/check-runs?per_page=100`)).check_runs;
    const c = checks.find((x) => x.name === "check");
    if (c?.status === "completed") {
      state = c.conclusion ?? "failure";
      break;
    }
  }
  // CI を待つあいだに main が進んでいたら、マージしない（古い版をもとに作った戻しを、新しい main に重ねない。PR #166 の ai-review の指摘）
  git("fetch", "--quiet", "origin", "main");
  const now = git("rev-parse", "origin/main");
  if (now !== d.merge) return notify(`🙋 PR #${d.pr} を元に戻す PR を作りましたが、CI を待つあいだに main が進んだ（${now.slice(0, 7)}）ので、マージしていません。人が見て判断してください: ${pr.html_url}`);
  if (state !== "success") return notify(`🙋 本番の確認が2回続けて失敗したので、PR #${d.pr} を元に戻す PR を作りましたが、CI が${state === "pending" ? "終わりません" : "通りません"}でした。人が見て判断してください: ${pr.html_url}`);
  await gh(`/pulls/${pr.number}/merge`, { method: "PUT", body: JSON.stringify({ merge_method: "merge", sha: head }) }, AUTO_MERGE_TOKEN);
  await notify(`↩️ 本番の確認が2回続けて失敗したので、PR #${d.pr} を自動で元に戻しました: ${pr.html_url}\n${d.reason}`);
}

main().catch(async (e) => {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(msg);
  await notify(`⚠️ 自動の戻しで失敗しました: ${msg.slice(0, 200)}`);
  process.exit(1);
});
