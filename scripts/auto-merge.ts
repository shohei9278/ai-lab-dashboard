// 自動マージ（.github/workflows/auto-merge.yml から、必ず main のコードで動く。決まりは scripts/auto-merge-rules.ts）
// ルーティンが作った PR（claude/proposal-<番号>）を見回り、次のどれかをする（運営者が決めた）
// - マージ: CI が通り、自動で触れない所に触れておらず、本番が作業中でなく、本番の確認が通っていて、この見回りが自分で呼んだ GPT と Gemini のどちらも直すべき指摘（🔴・🟡）なし
// - 直させる: 直すべき指摘があれば、提案箱のルーティンに、同じブランチで直させる（3回まで）
// - 人に回す: 3回直しても残る・自動で触れない所に触れている・CI が落ちた・レビューを読めない など
// したことは PR にコメントし、Discord に知らせる
// PR のコードは動かさない（差分は git で取り出して、レビューの材料として読むだけ）。PR のコメントの「指摘なし」は信じない（誰でもボットとして書けるため）
import { execFileSync } from "node:child_process";
import { AUTO_BRANCH, HUMAN_MARK, afterReview, beforeReview, changedPaths, fireRejected, fixMarker, fixRequested, fixRounds, fixText, handedToHuman, reviewHistory, reviewMarker, reviewPosted, type Decision, type PrComment } from "./auto-merge-rules";
import { REVIEWERS, askReviewer, blocking, parseReview, reviewComment, reviewInput, reviewInstructions, type Review, type Reviewer } from "./ai-review-core";
import { OMITTED } from "./ai-review-omitted";

const { GITHUB_REPOSITORY, GITHUB_TOKEN, AUTO_MERGE_TOKEN, NOTIFY_WEBHOOK_URL, CLAUDE_ROUTINE_FIRE_URL, CLAUDE_ROUTINE_TOKEN, OPENAI_API_KEY, GEMINI_API_KEY } = process.env;
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

// Discord に知らせる。送れなかったら、見回りの記録（Actions のログ）に残す（PR #153 の ai-review の指摘）
async function notify(text: string) {
  if (!NOTIFY_WEBHOOK_URL) return;
  for (let i = 0; i < 2; i++) {
    const res = await fetch(NOTIFY_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: text.slice(0, 1900), allowed_mentions: { parse: [] } }),
      signal: AbortSignal.timeout(20_000),
    }).catch(() => null);
    if (res?.ok) return;
    console.error(`Discord に知らせられませんでした（${res ? res.status : "通信の失敗"}）`);
    if (res && res.status < 500 && res.status !== 429) return;
    await new Promise((ok) => setTimeout(ok, 3000));
  }
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
  // main の結果だけを見る（ほかのブランチの結果で決めない。PR #153 の ai-review の指摘）
  const r = await gh<{ workflow_runs: { conclusion: string | null }[] }>("/actions/workflows/smoke.yml/runs?branch=main&status=completed&per_page=10").catch(() => null);
  const last = r?.workflow_runs.find((x) => x.conclusion && x.conclusion !== "skipped" && x.conclusion !== "cancelled");
  return last ? last.conclusion === "success" : null;
}

// 起動が届いていないと分かるとき（設定がない・起動先がはっきり断った）。時間切れ・通信の失敗・5xx・408・429 は、届いたか分からないので別に扱う
class FireRejected extends Error {}

async function fireFix(text: string) {
  if (!FIRE_URL.test(CLAUDE_ROUTINE_FIRE_URL ?? "") || !CLAUDE_ROUTINE_TOKEN) throw new FireRejected("ルーティンの起動の URL かトークンがありません（GitHub の Secrets）");
  const res = await fetch(CLAUDE_ROUTINE_FIRE_URL!, {
    method: "POST",
    headers: { Authorization: `Bearer ${CLAUDE_ROUTINE_TOKEN}`, "anthropic-beta": "experimental-cc-routine-2026-04-01", "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(20_000),
  });
  // 応答の中身は出さない（トークンの手がかりになりうる）
  if (!res.ok) throw fireRejected(res.status) ? new FireRejected(`ルーティンを起動できませんでした（${res.status}）`) : new Error(`ルーティンの起動の応答が失敗でした（${res.status}）。届いたかは分かりません`);
}

type Pull = { number: number; title: string; body: string | null; draft: boolean; html_url: string; head: { ref: string; sha: string; repo: { full_name: string } | null }; base: { ref: string; repo: { full_name: string } | null } };
type CheckRun = { name: string; status: string; conclusion: string | null };

// 100件ずつ全部読む。上限のページまで埋まっていたら、読みきれていないとして complete=false
async function pages<T>(path: string, max: number): Promise<{ items: T[]; complete: boolean }> {
  const items: T[] = [];
  for (let page = 1; page <= max; page++) {
    const got = await gh<T[]>(`${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`);
    items.push(...got);
    if (got.length < 100) return { items, complete: true };
  }
  return { items, complete: false };
}

// この版の差分を git で取り出す（PR のコードは動かさない）。取り出した先頭が、確かめている版と違えば止める
function diffOf(pr: Pull): string {
  execFileSync("git", ["fetch", "--quiet", "origin", "main", `+refs/heads/${pr.head.ref}:refs/remotes/origin/${pr.head.ref}`]);
  const head = execFileSync("git", ["rev-parse", `refs/remotes/origin/${pr.head.ref}`], { encoding: "utf8" }).trim();
  if (head !== pr.head.sha) throw new Error("確かめている間に、PR に新しい push があった");
  return execFileSync("git", ["diff", `origin/main...${pr.head.sha}`, "--", ".", ...OMITTED.map((f) => `:!${f}`)], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

// GPT と Gemini に、この見回りの中でレビューを頼む（答えは、この中でだけ使う）
// 渡す過去のものは、見回りが書いた前の版へのレビューだけで、直ったかを確かめる項目として使う（指摘を消す根拠にはさせない）
async function reviewBoth(pr: Pull, history: string): Promise<Partial<Record<Reviewer, Review>>> {
  const { input, cut } = reviewInput({ prBody: pr.body ?? "", history, diff: diffOf(pr) });
  const instructions = reviewInstructions({ autoPr: true, withHistory: false, recheck: !!history });
  const out: Partial<Record<Reviewer, Review>> = {};
  await Promise.all(REVIEWERS.map(async (r) => {
    try {
      out[r] = parseReview(r, await askReviewer(r, instructions, input, { openai: OPENAI_API_KEY, gemini: GEMINI_API_KEY }), cut);
    } catch (e) {
      console.error(`#${pr.number}: ${r} のレビューに失敗: ${e instanceof Error ? e.message : String(e)}`);
    }
  }));
  return out;
}

async function toHuman(pr: Pull, link: string, why: string): Promise<Decision> {
  await comment(pr.number, `🙋 自動ではマージしません: ${why}。人が見て判断してください。\n\n${HUMAN_MARK}`);
  await notify(`🙋 人の判断が要る PR: ${link}\n${why}`);
  return { action: "human", reason: why };
}

async function handle(pr: Pull, idle: boolean | null, smoke: boolean | null): Promise<Decision> {
  // コメントは、止める方向の印（人に回した・この版の直しは頼んだ・直させた回数）にだけ使う
  const { items: comments, complete: commentsComplete } = await pages<PrComment & { body: string }>(`/issues/${pr.number}/comments`, 20);
  if (handedToHuman(comments)) return { action: "wait", reason: "人に回したまま" };
  const checks = (await gh<{ check_runs: CheckRun[] }>(`/commits/${pr.head.sha}/check-runs?per_page=100`)).check_runs;
  // 変えたファイルを全部読む（GitHub は1つの PR で3000件まで）。名前を変えたものは、前の名前も見る
  const { items: files, complete: filesComplete } = await pages<{ filename: string; previous_filename?: string }>(`/pulls/${pr.number}/files`, 30);
  const link = `#${pr.number}「${pr.title}」 ${pr.html_url}`;
  const history = reviewHistory(comments);
  const pre = beforeReview({
    branch: pr.head.ref, sameRepo: pr.head.repo?.full_name === GITHUB_REPOSITORY,
    baseMain: pr.base.ref === "main" && pr.base.repo?.full_name === GITHUB_REPOSITORY, draft: pr.draft,
    checksDone: checks.length > 0 && checks.every((c) => c.status === "completed"),
    ciOk: checks.find((c) => c.name === "check")?.conclusion === "success",
    files: changedPaths(files), filesComplete, commentsComplete, historyOk: history.ok, fixRequestedNow: fixRequested(comments, pr.head.sha),
    productionIdle: idle, smokeOk: smoke,
  });
  if (pre.action === "human") return toHuman(pr, link, pre.reason);
  if (pre.action !== "review") return pre;
  if (!AUTO_MERGE_TOKEN) return { action: "wait", reason: "AUTO_MERGE_TOKEN がない" };
  // APIキーがないと、いつまでもレビューできないので、人に回す（通信の一時的な失敗は、次の見回りでもう一度頼む。PR #153 の ai-review の指摘）
  const noKey = REVIEWERS.filter((r) => !(r === "gpt" ? OPENAI_API_KEY : GEMINI_API_KEY));
  if (noKey.length) return toHuman(pr, link, `レビューを頼む API キーがない（${noKey.join("・")}。GitHub の Secrets）`);

  const reviews = await reviewBoth(pr, history.text);
  // 答えが返ってこなかった（通信の失敗など）ときは、次の見回りでもう一度頼む
  if (REVIEWERS.some((r) => !reviews[r])) return { action: "wait", reason: "レビューを頼めなかった（次の見回りでもう一度）" };
  // 人とルーティンが読めるよう、2社のレビューを PR に書く（ここに書いたものは、マージに進む判断には使わない）
  // 印を付けて、次の版のレビューに「直ったかを確かめる項目」として渡す
  let recorded = true;
  for (const r of REVIEWERS) {
    if (reviewPosted(comments, r, pr.head.sha)) continue;
    await comment(pr.number, `${reviewComment(reviews[r]!, "自動マージの見回りが頼んだレビューです（main のコードで動いています）。")}\n\n${reviewMarker(r, pr.head.sha)}`).catch((e) => {
      recorded = false;
      console.error(`#${pr.number}: ${r} のレビューのコメントに失敗: ${e instanceof Error ? e.message : String(e)}`);
    });
  }
  const d = afterReview(reviews, fixRounds(comments));
  // 直しを頼むのは、レビューを PR に書けたときだけ（書けないと、次の版のレビューに、この指摘が渡らない。PR #153 の ai-review の指摘）
  if (d.action === "fix" && !recorded) return { action: "wait", reason: "レビューを PR に書けなかった（次の見回りでもう一度）" };

  if (d.action === "merge") {
    // レビューには数分かかるので、マージの直前に、本番が作業中でないか・本番の確認が通っているかを見直す（PR #153 の ai-review の指摘）
    const [idleNow, smokeNow] = await Promise.all([productionIdle(), smokeOk()]);
    if (idleNow !== true || smokeNow !== true) return { action: "wait", reason: "マージの直前に見直したら、本番が作業中か、本番の確認が通っていない（次の見回りでもう一度）" };
    // 確かめた版のままのときだけマージする（確かめたあとに push されていたら、GitHub が断る）
    await gh(`/pulls/${pr.number}/merge`, { method: "PUT", body: JSON.stringify({ merge_method: "merge", sha: pr.head.sha }) }, AUTO_MERGE_TOKEN);
    // マージできたら、コメントや知らせに失敗しても、マージしたとして返す（見回りを必ず終えて、続けてマージしない）
    await comment(pr.number, `🤖 自動でマージしました（${d.reason}）。`).catch((e) => console.error(`#${pr.number}: マージのコメントに失敗: ${e instanceof Error ? e.message : String(e)}`));
    await notify(`🤖 自動でマージしました: ${link}\n${d.reason}`);
  } else if (d.action === "fix") {
    const text = fixText(pr, REVIEWERS.flatMap((r) => blocking(reviews[r]!)));
    if (!text) return toHuman(pr, link, "直すべき指摘が長く、ルーティンに全部を渡せない");
    // 先に「頼む」という印を書いてから起動する（起動のあとに印を書けないと、次の見回りで同じ版の直しをもう一度頼んでしまうため）
    const mark = await gh<{ id: number }>(`/issues/${pr.number}/comments`, { method: "POST", body: JSON.stringify({ body: `🔧 ${d.reason}。提案箱のルーティンに、このブランチで直してもらうよう頼みます。\n\n${fixMarker(pr.head.sha)}` }) });
    try {
      await fireFix(text);
    } catch (e) {
      // はっきり断られたときだけ印を消して、次の見回りで頼み直す。時間切れ・通信の失敗は届いたか分からないので、印を残す（同じ直しを二度頼まない）
      if (e instanceof FireRejected) await gh(`/issues/comments/${mark.id}`, { method: "DELETE" }).catch(() => undefined);
      else await notify(`⚠️ ルーティンへの直しの依頼が届いたか分かりません（#${pr.number}）。作業が始まっていなければ、PR の「🔧」のコメントを消すと、次の見回りで頼み直します`);
      throw e;
    }
    await notify(`🔧 レビューの指摘を、ルーティンに直してもらいます: ${link}\n${d.reason}`);
  } else if (d.action === "human") {
    return toHuman(pr, link, d.reason);
  }
  return d;
}

async function main() {
  if (!GITHUB_REPOSITORY || !GITHUB_TOKEN) throw new Error("GITHUB_REPOSITORY と GITHUB_TOKEN が要ります");
  // 開いている PR を全部読む（PR #153 の ai-review の指摘）
  const open = await pages<Pull>("/pulls?state=open", 10);
  // 読みきれないときは、見回りを失敗にする（一部だけ見て進めない。失敗は Actions が知らせる）
  if (!open.complete) throw new Error("開いている PR が多すぎて、自動マージの見回りが全部を見られません");
  const pulls = open.items.filter((p) => AUTO_BRANCH.test(p.head.ref));
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
