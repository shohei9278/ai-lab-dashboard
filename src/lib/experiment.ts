import { db, getSettings, type ProjectRow } from "./db";
import { autoPublishStats, designAuthorStats, ideaAuthorStats, projectTotals, shadowScores } from "./loop";
import { costEfficiency } from "./cost";
import { modelInfo } from "./models";
import { runStats } from "./stats";

// 実験結果のページ用: プロダクトそのものではなく、「AIに任せるとどうなるか」の結果を、数字とランキングにまとめる

export type RankRow = { modelId: string; label: string; provider: string; value: number; n: number; display: string };
export type Ranking = {
  key: string;
  title: string;
  question: string; // この部門で何を比べているか（一言）
  better: "high" | "low";
  max?: number; // 棒の長さの基準（無ければ1位の値）
  rows: RankRow[]; // 良い順
  empty: string; // データがないときの説明
};

const pt = (x: number) => `${x.toFixed(1)}点`;
const pc = (x: number) => `${Math.round(x * 100)}%`;
const yen = (x: number) => `${Math.round(x).toLocaleString("ja-JP")}円`;

function rank(rows: Omit<RankRow, "label" | "provider">[], better: "high" | "low"): RankRow[] {
  return rows
    .map((r) => ({ ...r, label: modelInfo(r.modelId).label, provider: modelInfo(r.modelId).provider }))
    .sort((a, b) => (better === "high" ? b.value - a.value : a.value - b.value));
}

export function rankings(): Ranking[] {
  const ideas = ideaAuthorStats();
  const designs = designAuthorStats();
  const judges = shadowScores();
  const cost = costEfficiency();
  const latest = db().prepare("SELECT id FROM runs WHERE status = 'done' AND mock = 0 ORDER BY id DESC LIMIT 1").get() as { id: number } | undefined;
  const test = latest ? runStats(latest.id) : null;

  return [
    {
      key: "idea", title: "アイデア力", question: "他社のAIが、作者を伏せて付けた点（10点満点）", better: "high", max: 10,
      empty: "毎日の自動実行で3社がアイデアを出すと、たまっていきます",
      rows: rank(ideas.filter((s) => s.scoreFromOthers !== null).map((s) => ({ modelId: s.author, value: s.scoreFromOthers!, n: s.candidates, display: pt(s.scoreFromOthers!) })), "high"),
    },
    {
      key: "picked", title: "アイデアの採用率", question: "出したアイデアのうち、採点で上位に選ばれて案件になった割合", better: "high", max: 1,
      empty: "毎日の自動実行で3社がアイデアを出すと、たまっていきます",
      rows: rank(ideas.filter((s) => s.candidates > 0).map((s) => ({ modelId: s.author, value: s.selected / s.candidates, n: s.candidates, display: `${pc(s.selected / s.candidates)}（${s.selected}/${s.candidates}）` })), "high"),
    },
    {
      key: "design", title: "ページの文章・構成力", question: "LPの候補に、他社のAIが作者を伏せて付けた点（10点満点）", better: "high", max: 10,
      empty: "事前登録LPを3社の候補から選ぶと、たまっていきます",
      rows: rank(designs.filter((s) => s.scoreFromOthers !== null).map((s) => ({ modelId: s.author, value: s.scoreFromOthers!, n: s.candidates, display: pt(s.scoreFromOthers!) })), "high"),
    },
    {
      key: "result", title: "アイデアの実績", question: "そのAIのアイデアの案件で、訪問者のうち登録・利用した割合", better: "high",
      empty: "公開した案件に訪問者が来ると、たまっていきます",
      rows: rank(ideas.filter((s) => s.rate !== null).map((s) => ({ modelId: s.author, value: s.rate!, n: s.projectsWithTraffic, display: `${(s.rate! * 100).toFixed(1)}%（${s.projectsWithTraffic}件）` })), "high"),
    },
    {
      key: "costper", title: "コスパ", question: "そのAIのアイデアの案件で、成果1件あたりにかかった費用（安いほど上）", better: "low",
      empty: "公開した案件で登録・利用が出ると、たまっていきます",
      rows: rank(cost.byIdeaAuthor.filter((g) => g.perConversion !== null).map((g) => ({ modelId: g.key, value: g.perConversion!, n: g.conversions, display: yen(g.perConversion!) })), "low"),
    },
    {
      key: "fair", title: "審査の公平さ", question: "自分の案と他社の案に付けた点の差（小さいほど上。大きいと身内びいきの疑い）", better: "low", max: 3,
      empty: "3社がお互いのアイデアを採点すると、たまっていきます",
      rows: rank(ideas.filter((s) => s.scoreFromSelf !== null && s.scoreGivenToOthers !== null).map((s) => {
        const d = s.scoreFromSelf! - s.scoreGivenToOthers!;
        return { modelId: s.author, value: Math.abs(d), n: s.candidates, display: `${d >= 0 ? "+" : ""}${d.toFixed(1)}点` };
      }), "low"),
    },
    {
      key: "judge", title: "判断力", question: "続ける・改善・撤退の判断で、担当のAIと同じ答えを出した割合（全自動では人の判断の代わりに担当AIと比べる）", better: "high", max: 1,
      empty: "公開した案件でAIが判断すると、たまっていきます",
      rows: rank(judges.filter((s) => (s.agreeInitial ?? s.agreePrimary) !== null).map((s) => {
        const human = s.agreeInitial !== null;
        const v = (s.agreeInitial ?? s.agreePrimary)!;
        return { modelId: s.modelId, value: v, n: human ? s.agreeInitialN : s.agreePrimaryN, display: `${pc(v)}${human ? "（人と）" : ""}` };
      }), "high"),
    },
    {
      key: "test", title: "基礎テストの正答率", question: "答えが決まった問題（問い合わせ分類・請求書抽出）での正答率", better: "high", max: 1,
      empty: "実APIで基礎テストを実行すると、出ます",
      rows: test ? rank(test.models.filter((m) => m.calls > 0).map((m) => ({ modelId: m.modelId, value: m.accuracy, n: m.calls, display: pc(m.accuracy) })), "high") : [],
    },
  ];
}

// 部門ごとの1位を数えた総合順位（1位の数が同じなら、2位の数で比べる）
export function overallRanking(list: Ranking[]) {
  const score = new Map<string, { modelId: string; label: string; provider: string; first: number; second: number; entered: number }>();
  for (const r of list) {
    r.rows.forEach((row, i) => {
      const s = score.get(row.modelId) ?? { modelId: row.modelId, label: row.label, provider: row.provider, first: 0, second: 0, entered: 0 };
      s.entered++;
      if (i === 0 && r.rows.length > 1) s.first++;
      if (i === 1) s.second++;
      score.set(row.modelId, s);
    });
  }
  return [...score.values()].sort((a, b) => b.first - a.first || b.second - a.second);
}

// 上に出す大きな数字
export function headline() {
  const s = getSettings();
  const projects = db().prepare("SELECT * FROM projects WHERE demo = 0").all() as ProjectRow[];
  const published = projects.filter((p) => p.public_slug).length;
  const totals = projects.map((p) => projectTotals(p.id));
  const visits = totals.reduce((n, t) => n + t.visits, 0);
  const conversions = totals.reduce((n, t) => n + t.signups, 0);
  const allCost = (db().prepare("SELECT COALESCE(SUM(cost_usd), 0) AS s, COUNT(*) AS n FROM ai_calls WHERE error IS NULL").get() as { s: number; n: number });
  const auto = autoPublishStats();
  const blocked = (db().prepare("SELECT COUNT(*) AS n FROM events WHERE kind = 'auto-blocked'").get() as { n: number }).n;
  const aiDecisions = (db().prepare("SELECT COUNT(*) AS n FROM events WHERE kind IN ('auto-decision', 'auto-improve')").get() as { n: number }).n;
  const humanActs = (db().prepare("SELECT COUNT(*) AS n FROM events WHERE actor = 'human'").get() as { n: number }).n;
  const posts = (db().prepare("SELECT COUNT(*) AS n FROM sns_posts WHERE status = 'posted'").get() as { n: number }).n;
  return {
    projects: projects.length, published, visits, conversions,
    rate: visits ? conversions / visits : null,
    aiJpy: allCost.s * s.usdJpy, aiCalls: allCost.n,
    perConversionJpy: conversions ? (allCost.s * s.usdJpy) / conversions : null,
    auto, blocked, aiDecisions, humanActs, posts,
    continued: projects.filter((p) => p.stage === "continued" || p.growth_phase).length,
    killed: projects.filter((p) => p.stage === "killed").length,
  };
}

// 出し方（事前登録LP・動くツール）ごとの成績
export function kindComparison() {
  const projects = db().prepare("SELECT * FROM projects WHERE demo = 0").all() as ProjectRow[];
  const cost = costEfficiency().byKind;
  return (["lp", "tool"] as const).map((kind) => {
    const mine = projects.filter((p) => p.kind === kind);
    const t = mine.map((p) => projectTotals(p.id));
    const visits = t.reduce((n, x) => n + x.visits, 0);
    const conv = t.reduce((n, x) => n + x.signups, 0);
    return {
      kind, projects: mine.length, published: mine.filter((p) => p.public_slug).length, visits, conversions: conv,
      rate: visits ? conv / visits : null,
      perConversion: cost.find((c) => c.key === kind)?.perConversion ?? null,
      continued: mine.filter((p) => p.stage === "continued" || p.growth_phase).length,
      killed: mine.filter((p) => p.stage === "killed").length,
    };
  });
}
