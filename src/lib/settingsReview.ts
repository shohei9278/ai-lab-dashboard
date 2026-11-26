import { db, getSettings, type ProjectRow, type Settings } from "./db";
import { AIMS, AIM_KEYS } from "./aims";
import { AIM_JUDGE_KEYS, aimBasis, judgeAim, judgeBasis } from "./judgeBasis";
import { logEvent } from "./loop";
import { addProposal } from "./voices";

// 設定の見直しの提案（11/26 に運営者が決めた）
// 週の定例会議で、AIが「実験の物差し」の設定の見直しを、根拠の数字と一緒に提案箱へ出す（運営者あて）。変えるかは運営者が設定の画面で決める。AIは設定を書き換えない
// 予算・広告費・全自動・緊急停止・投稿してよい場所など、お金と安全の設定は、提案もさせない（ここに無い項目は受け付けない）

export const REVIEWABLE: Partial<Record<keyof Settings, { label: string; min: number; max: number; pct?: boolean; step?: number }>> = {
  judgeMinVisits: { label: "判断に入る訪問数（一括の値）", min: 1, max: 100_000 },
  judgeAfterDays: { label: "訪問が少なくても判断する日数（一括の値）", min: 1, max: 60 },
  ...Object.fromEntries(AIM_KEYS.flatMap((a) => [
    [AIM_JUDGE_KEYS[a].visits, { label: `「${AIMS[a].label}」の判断に入る訪問数`, min: 0, max: 100_000 }],
    [AIM_JUDGE_KEYS[a].days, { label: `「${AIMS[a].label}」の訪問が少なくても判断する日数`, min: 0, max: 60 }],
  ])),
  // 割合は、設定の画面で保てる刻みだけ（登録率は0.1%、利用率は1%。PR #209 の ai-review の指摘）
  targetSignupRate: { label: "登録率の目標", min: 0.001, max: 1, pct: true, step: 1000 },
  targetUseRate: { label: "ツールの利用率の目標", min: 0.01, max: 1, pct: true, step: 100 },
  maxAutoImprove: { label: "人の承認なしで直してよい回数", min: 0, max: 10 },
  spreadJudgeDays: { label: "「広がる」を判定するまでの日数", min: 1, max: 14 },
  spreadHitPlays: { label: "「広がる」の当たりの基準（遊んだ人）", min: 1, max: 100_000 },
  spreadHitShares: { label: "「広がる」の当たりの基準（シェア）", min: 1, max: 100_000 },
  aimSpread: { label: "ねらいの配分（広がる）", min: 0, max: 10 },
  aimUseful: { label: "ねらいの配分（役に立つ）", min: 0, max: 10 },
  aimReturn: { label: "ねらいの配分（また来てもらう）", min: 0, max: 10 },
  aimDemand: { label: "ねらいの配分（需要を確かめる）", min: 0, max: 10 },
  dailyIdeaCount: { label: "1社あたりに出すアイデアの数", min: 1, max: 5 },
  dailyKeep: { label: "そのうち残す数", min: 1, max: 5 },
};
export const SETTING_PROPOSALS_PER_WEEK = 2;
export const SETTING_REPROPOSE_DAYS = 14;
// voices.ts の EXACT_TITLE_PREFIX と同じ文（読み込みの順番が回り込むので、値を直接書く。tests/judgeBasis.test.ts で同じかを確かめる）
export const SETTING_TITLE = "設定の見直し: ";

const show = (key: keyof Settings, v: number) => (REVIEWABLE[key]?.pct ? `${Math.round(v * 1000) / 10}%` : `${v}`);

// 中央値（件数が偶数なら、真ん中2つの平均）
export function medianOf(xs: number[]): number {
  const v = [...xs].sort((a, b) => a - b);
  if (!v.length) return 0;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : Math.round((v[m - 1] + v[m]) / 2);
}

// 定例会議の材料: 今の物差しと、ねらいごとに基準まで届いたか（直近60日に公開した案件）
export function settingsReviewText(s: Settings = getSettings()): string {
  const projects = db().prepare("SELECT * FROM projects WHERE demo = 0 AND published_at IS NOT NULL AND published_at >= datetime('now', '-60 days')").all() as ProjectRow[];
  const lines = AIM_KEYS.map((a) => {
    const b = aimBasis(a, s);
    const ps = projects.filter((p) => judgeAim(p) === a);
    if (!ps.length) return `- ${AIMS[a].label}: 基準 訪問${b.visits}人か${b.days}日${b.own ? "" : "（一括の値）"}・直近60日に公開した案件なし`;
    const reach = ps.map((p) => {
      const basis = judgeBasis(p, s);
      const rows = db().prepare("SELECT day, SUM(visits) AS v FROM metrics WHERE project_id = ? AND source != 'simulated' GROUP BY day ORDER BY day").all(p.id) as { day: string; v: number }[];
      // 全部の日を足しながら、基準に届いた最初の日だけを覚える（届いたあとの訪問も、合計に入れる。PR #209 の ai-review の指摘）
      let sum = 0;
      let hit: { day: string } | undefined;
      for (const r of rows) {
        sum += r.v;
        if (!hit && sum >= basis.visits) hit = r;
      }
      const pub = Date.parse(`${p.published_at!.replace(" ", "T")}Z`);
      return { reached: !!hit, days: hit ? Math.max(0, Math.round((Date.parse(`${hit.day}T00:00:00+09:00`) - pub) / 86_400_000)) : null, total: sum, stage: p.stage };
    });
    const ok = reach.filter((r) => r.reached);
    const avgDays = ok.length ? Math.round(ok.reduce((n, r) => n + (r.days ?? 0), 0) / ok.length) : null;
    const median = medianOf(reach.map((r) => r.total));
    return `- ${AIMS[a].label}: 基準 訪問${b.visits}人か${b.days}日${b.own ? "" : "（一括の値）"}・直近60日に公開した${ps.length}件のうち、基準の訪問に届いたのは${ok.length}件${avgDays !== null ? `（届くまで平均${avgDays}日）` : ""}・訪問の中央値${median}人・撤退${reach.filter((r) => r.stage === "killed").length}件`;
  });
  const keys = Object.keys(REVIEWABLE) as (keyof Settings)[];
  return `設定の物差し（運営者が設定の画面で決めている値。AIは書き換えない）:
${keys.map((k) => `- ${k}（${REVIEWABLE[k]!.label}）: ${show(k, Number(s[k]))}${k.startsWith("judgeVisits") || k.startsWith("judgeDays") ? (Number(s[k]) ? "" : "（0 は一括の値を使う）") : ""}`).join("\n")}
ねらいごとに、判断の基準まで届いたか:
${lines.join("\n")}`;
}

export const SETTINGS_RULE = `- settings: 設定の物差し（材料の「設定の物差し」にある項目だけ）を見直す案を0〜1件 [{"key":"項目の名前","value":数値,"why":"材料の数字の根拠"}]。基準に届く案件がほとんどない・届くのが早すぎて判断が粗い・目標が実績とかけ離れている など、数字ではっきり言えるときだけ出す（なければ空の配列）。割合の項目は 0〜1 の小数で書く。予算・広告費・全自動・緊急停止・投稿してよい場所は出さない。出した案は運営者あてに提案箱に入り、変えるかは運営者が決める`;

type Raw = { key?: unknown; value?: unknown; why?: unknown };

// 社員の案をまとめて、提案箱に入れる（直近7日で2件まで・同じ項目は14日に1回・今と同じ値や範囲の外は入れない）
export function addSettingProposals(list: { raw: unknown; proposer: string }[], meetingId: number | null, s: Settings = getSettings()): number {
  const seen = new Set<string>();
  let added = 0;
  // 週2件は、直近7日に入った設定の見直しも数える（同じ週に会議を開き直しても、超えないように。PR #209 の ai-review の指摘）
  const thisWeek = () => (db().prepare("SELECT COUNT(*) AS n FROM plan_requests WHERE title LIKE ? AND created_at >= datetime('now', '-7 days')").get(`${SETTING_TITLE}%`) as { n: number }).n;
  for (const { raw, proposer } of list) {
    if (thisWeek() >= SETTING_PROPOSALS_PER_WEEK) break;
    const o = (raw && typeof raw === "object" ? raw : {}) as Raw;
    // 登録した項目だけ（継承した名前は受け付けない）。値は本物の数だけ（null・true などを0や1として扱わない。PR #209 の ai-review の指摘）
    const key = typeof o.key === "string" && Object.hasOwn(REVIEWABLE, o.key) ? (o.key as keyof Settings) : null;
    const meta = key ? REVIEWABLE[key] : undefined;
    const value = typeof o.value === "number" ? o.value : NaN;
    const why = typeof o.why === "string" ? o.why.trim().slice(0, 400) : "";
    const onStep = !meta?.step || Math.abs(value * meta.step - Math.round(value * meta.step)) < 1e-9;
    const whole = meta?.pct || Number.isInteger(value);
    if (!key || !meta || !why || !Number.isFinite(value) || !onStep || !whole || value < meta.min || value > meta.max || value === Number(s[key]) || seen.has(key)) continue;
    seen.add(key);
    const recent = db().prepare("SELECT 1 FROM plan_requests WHERE title LIKE ? AND created_at >= datetime('now', ?)").get(`${SETTING_TITLE}${meta.label}%`, `-${SETTING_REPROPOSE_DAYS} days`);
    if (recent) continue;
    const title = `${SETTING_TITLE}${meta.label}`;
    const how = `設定の画面で「${meta.label}」（${key}）を ${show(key, Number(s[key]))} から ${show(key, value)} にする。変えるかは運営者が決める（AIは設定を書き換えない）`;
    const rid = addProposal({ title, how, why, target: "human", source: "meeting", proposer, meetingId, scene: "週の定例会議", exact: true });
    if (rid) {
      added++;
      logEvent(null, "ai", "setting-proposal", `定例会議で、設定の見直しを提案箱に入れました: ${meta.label} を ${show(key, Number(s[key]))} → ${show(key, value)}（${why.slice(0, 80)}）`);
    }
  }
  return added;
}
