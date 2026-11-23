import { db } from "./db";
import { logEvent } from "./loop";
import { sourceLabel, type RequestRow } from "./plan";
import { fireRoutine, routineConfigured, type Fetch } from "./routine";

// 提案箱の「仕組みの改善」を、クラウドの Claude Code（ルーティン）に直させ、PR にしてもらう
// 人がするのは、提案箱で「AIに直させる」を押すことと、できた PR を見てマージすることだけ（運営者が決めた。ルーティンで動かすのも運営者が選んだ）
// - ルーティンの起動の URL とトークンは Railway の変数にだけ置く（CLAUDE_ROUTINE_FIRE_URL・CLAUDE_ROUTINE_TOKEN。設定の手順は docs/SETUP-AI-FIX.md）
// - ルーティンに渡すのは、提案の中身と、運営者のひとことだけ（個人の情報・下書き・AIの入出力は渡さない）
// - ルーティンはサブスクの使用量で動く。1つのルーティンは1時間に30回までしか起動できないので、同じ提案は1時間に1回まで
// - 直す手順と守ること（main に入れない・マージしない・CI を変えない など）は、ルーティンに保存する指示（docs/routine-proposal-fix.md）に書く

export const REPO_URL = "https://github.com/shohei9278/ai-lab-dashboard";
const RETRY_MS = 60 * 60 * 1000;

// トークンを、決まった送り先（Anthropic のルーティンの起動）以外に送らない（routine.ts）
export const aiFixConfigured = () => routineConfigured("CLAUDE_ROUTINE_FIRE_URL", "CLAUDE_ROUTINE_TOKEN");
// ルーティンが作るブランチの名前（PR を探すのにも使う）
export const aiFixBranch = (id: number) => `claude/proposal-${id}`;
export const aiFixPrsUrl = (id: number) => `${REPO_URL}/pulls?q=${encodeURIComponent(`is:pr head:${aiFixBranch(id)}`)}`;

// 同じ提案を、もう一度頼めるか（前に頼んでから1時間たったら。できた PR がレビュー待ちの間は頼めない）
export function aiFixRetryable(r: Pick<RequestRow, "ai_fix_at" | "ai_fix_pr_state">, now = Date.now()): boolean {
  if (!r.ai_fix_at) return true;
  if (r.ai_fix_pr_state === "open") return false;
  const t = Date.parse(`${r.ai_fix_at.replace(" ", "T")}Z`);
  return !Number.isFinite(t) || now - t >= RETRY_MS;
}

// ルーティンに渡す文（ルーティンの側では、外から来た信用しない文として受け取る）
export function aiFixText(r: RequestRow, note: string): string {
  return [
    `提案箱 #${r.id}`,
    `題: ${r.title}`,
    r.how ? `何をどう変えるか: ${r.how}` : "",
    r.why ? `理由: ${r.why}` : "",
    `出どころ: ${r.source === "human" ? "運営者" : sourceLabel(r)}${r.scene && r.source === "scene" ? `（${r.scene}）` : ""}${r.score !== null ? `・ほかのAIの評価 ${r.score.toFixed(1)}点` : ""}${r.project_id ? `・案件 #${r.project_id}` : ""}`,
    note ? `運営者のひとこと: ${note}` : "",
    `ブランチ: ${aiFixBranch(r.id)}`,
  ].filter(Boolean).join("\n");
}


// 運営者が「AIに直させる」を押したとき。ルーティンを起動し、作業の画面の URL を覚える
// by: 運営者が押したか、自動で頼んだか（autoAsk.ts。自動のときは守り・攻めごとに記録の種類を分ける。記録の書き方だけが変わる）
export async function startAiFix(id: number, note: string, fetchImpl: Fetch = fetch, by: "human" | "auto-fix" | "auto-growth" = "human"): Promise<{ sessionUrl: string | null }> {
  if (!aiFixConfigured()) throw new Error("Claude Code のルーティンがまだつながっていません（docs/SETUP-AI-FIX.md）");
  const r = db().prepare("SELECT * FROM plan_requests WHERE id = ?").get(id) as RequestRow | undefined;
  if (!r || r.status !== "open" || r.target !== "system") throw new Error("まだ答えていない「仕組みの改善」だけ頼めます");
  if (!aiFixRetryable(r)) throw new Error(r.ai_fix_pr_state === "open" ? "できた PR がレビュー待ちです。マージするか閉じてから頼めます" : "頼んだばかりです。1時間たってから、もう一度頼めます");
  const clean = note.trim().slice(0, 300);
  const url = await fireRoutine("CLAUDE_ROUTINE_FIRE_URL", "CLAUDE_ROUTINE_TOKEN", aiFixText(r, clean), fetchImpl);
  // 頼み直したときは、前の PR の番号と状態を消す（新しい PR が見つかるまで「PR はまだ見つかっていません」と出す。PR #126 の ai-review の指摘）
  db().prepare("UPDATE plan_requests SET ai_fix_at = datetime('now'), ai_fix_url = ?, ai_fix_note = ?, ai_fix_pr = NULL, ai_fix_pr_state = NULL WHERE id = ?").run(url, clean || null, id);
  if (by !== "human") logEvent(null, "system", `auto-ask-${by === "auto-fix" ? "fix" : "growth"}`, `提案箱の「${r.title}」を、自動で Claude Code に直してもらうよう頼みました（${clean}）`);
  else logEvent(null, "human", "plan-request-ai-fix", `提案箱の「${r.title}」を、Claude Code に直してもらうよう頼んだ（PR ができたら、見てマージする）`);
  return { sessionUrl: url };
}

// ルーティンが作った PR の状態を GitHub から読み、提案箱に出す。マージされていたら「やった」にする（1時間に1回）
// 人がするのはマージだけ（運営者が決めた）。閉じた（マージしなかった）ときは、見送りにはせず、運営者の返事を待つ
// リポジトリは公開なので、トークンなしで読める（GITHUB_TOKEN があれば使う。1時間に60回までの制限を避けるため）
// 読むのは、頼んでから30日以内で、まだ返事のない提案だけ
const gSync = globalThis as unknown as { __aiLabAiFixSync?: number };
type Pull = { number: number; state: string; merged_at: string | null; html_url: string; created_at?: string };
export async function syncAiFixPrs(fetchImpl: Fetch = fetch, force = false): Promise<number> {
  if (!force && gSync.__aiLabAiFixSync && Date.now() - gSync.__aiLabAiFixSync < 3_600_000) return 0;
  gSync.__aiLabAiFixSync = Date.now();
  // PR が開いているものは、提案の返事（見送りなど）や頼んだ日に関係なく読み直す（自動の依頼が「PR が開いている間は次を頼まない」を正しく判断できるように。autoAsk.ts）
  // 読む順は、PR が開いているもの → PR がまだ見つかっていないもの → 閉じたもの（閉じた PR の行が20件を占めて、開いている PR が読まれないままにならないように。PR #154 の ai-review の指摘）
  const rows = db().prepare("SELECT * FROM plan_requests WHERE ai_fix_at IS NOT NULL AND ((status = 'open' AND ai_fix_at >= datetime('now', '-30 days')) OR ai_fix_pr_state = 'open') ORDER BY CASE WHEN ai_fix_pr_state = 'open' THEN 0 WHEN ai_fix_pr IS NULL THEN 1 ELSE 2 END, ai_fix_at DESC, id LIMIT 20").all() as RequestRow[];
  const repo = REPO_URL.replace("https://github.com/", "");
  const owner = repo.split("/")[0];
  let done = 0;
  for (const r of rows) {
    const res = await fetchImpl(`https://api.github.com/repos/${repo}/pulls?state=all&per_page=10&head=${encodeURIComponent(`${owner}:${aiFixBranch(r.id)}`)}`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "ai-lab-dashboard", ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`GitHub から PR の状態を読めませんでした（${res.status}）`);
    // 頼んだあとに作られた PR だけを見る（頼み直したとき、前の閉じた PR を拾い直さない。PR #126 の ai-review の指摘）
    // 頼んだ時刻は秒までなので、1分前からを許す
    const asked = Date.parse(`${r.ai_fix_at!.replace(" ", "T")}Z`) - 60_000;
    const pulls = ((await res.json()) as Pull[]).filter((x) => Number.isInteger(x.number) && (!x.created_at || !Number.isFinite(asked) || Date.parse(x.created_at) >= asked));
    if (!pulls.length) continue;
    // 頼み直して PR が2つ以上あるときは、マージされたものを、なければいちばん新しいものを見る
    const pr = pulls.find((x) => x.merged_at) ?? pulls.reduce((a, b) => (b.number > a.number ? b : a));
    const state = pr.merged_at ? "merged" : pr.state === "open" ? "open" : "closed";
    db().prepare("UPDATE plan_requests SET ai_fix_pr = ?, ai_fix_pr_state = ? WHERE id = ?").run(pr.number, state, r.id);
    if (state === "merged") {
      const n = db().prepare("UPDATE plan_requests SET status = 'done', note = ?, decided_at = datetime('now') WHERE id = ? AND status = 'open'").run(`Claude Code が直した PR #${pr.number} をマージした（自動で記録）`, r.id).changes;
      if (n) {
        done++;
        logEvent(null, "system", "plan-request", `提案箱の「${r.title}」: Claude Code が直した PR #${pr.number} がマージされたので、「やった」にしました`);
      }
    }
  }
  return done;
}

// 提案箱に出す PR の状態
export function aiFixPrLabel(r: Pick<RequestRow, "ai_fix_pr" | "ai_fix_pr_state">): string | null {
  if (!r.ai_fix_pr) return null;
  return `PR #${r.ai_fix_pr}（${r.ai_fix_pr_state === "merged" ? "マージ済み" : r.ai_fix_pr_state === "closed" ? "閉じた" : "レビュー待ち"}）`;
}
export const aiFixPrUrl = (n: number) => `${REPO_URL}/pull/${n}`;
