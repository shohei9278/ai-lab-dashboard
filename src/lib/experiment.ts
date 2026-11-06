import { db, getSettings, type ProjectRow } from "./db";
import { END_REASON_LABEL, autoPublishStats, designAuthorStats, ideaAuthorStats, projectTotals, shadowScores } from "./loop";
import { costEfficiency } from "./cost";
import { modelInfo } from "./models";
import { runStats } from "./stats";
import { planModelStats, predictionStats } from "./plan";

// AIの成績のページ用: プロダクトそのものではなく、「AIに任せるとどうなるか」の結果を、数字とランキングにまとめる

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
      key: "visual", title: "見た目のデザイン力", question: "LPのページを作り比べた画面に、他社のAIが作者を伏せて付けた点（10点満点）", better: "high", max: 10,
      empty: "事前登録LPのページを、Claude と別の会社のAIで作り比べると、たまっていきます",
      rows: rank(designModelEffect().filter((d) => d.neutral !== null).map((d) => ({ modelId: d.modelId, value: d.neutral!, n: d.n, display: `${pt(d.neutral!)}（選ばれた ${d.won}/${d.n}回）` })), "high"),
    },
    {
      key: "plan", title: "運営の計画力", question: "毎日の計画を担当した日に、その日の目標（訪問・登録・利用）にどこまで届いたかの平均（3社で日ごとに交代）", better: "high", max: 1,
      empty: "毎日の計画を3社が担当すると、1日ごとにたまっていきます",
      rows: rank(planModelStats().filter((m) => m.goalRate !== null).map((m) => ({ modelId: m.modelId, value: m.goalRate!, n: m.days, display: `${pc(m.goalRate!)}（${m.days}日・予定の消化 ${pc(m.taskRate)}）` })), "high"),
    },
    {
      key: "predict", title: "予想の正確さ", question: "朝会で「今日の訪問は実際にいくつになるか」を予想し、実測とどれだけずれたかの平均（小さいほど上。目標の立て方に左右されない）", better: "low",
      empty: "朝会を担当した日の翌日から、たまっていきます",
      rows: rank(predictionStats().map((m) => ({
        modelId: m.modelId, value: m.mae, n: m.days,
        display: `ずれ ${m.mae.toFixed(1)}人（${Math.abs(m.bias) < 0.5 ? "偏りなし" : m.bias > 0 ? `慎重め・実際が平均${m.bias.toFixed(1)}人多い` : `楽観的・実際が平均${(-m.bias).toFixed(1)}人少ない`}）`,
      })), "low"),
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
    ...toolRankings(),
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

// 撤退した理由の内訳（AIが苦手なのは、届けるところか・使ってもらうところか・広めるところか）
export function endReasons() {
  const rows = db().prepare("SELECT end_reason AS r, kind, COUNT(*) AS n FROM projects WHERE demo = 0 AND stage = 'killed' GROUP BY end_reason, kind").all() as { r: string | null; kind: string; n: number }[];
  return Object.keys(END_REASON_LABEL).map((key) => ({
    key, label: END_REASON_LABEL[key],
    n: rows.filter((x) => (x.r ?? "unreached") === key).reduce((a, x) => a + x.n, 0),
    lp: rows.filter((x) => (x.r ?? "unreached") === key && x.kind === "lp").reduce((a, x) => a + x.n, 0),
    tool: rows.filter((x) => (x.r ?? "unreached") === key && x.kind === "tool").reduce((a, x) => a + x.n, 0),
  })).filter((x) => x.n > 0);
}

// ツールのコードを書くAIの比べ合い（Opus・Sonnet・GPT を順番に使っている）
function toolRankings(): Ranking[] {
  const s = getSettings();
  // 各ツールの最初の版（その案件で最初にコードを書いたAIと、その出来）
  const firsts = db().prepare(
    `SELECT v.project_id, v.tool_model, v.tool_rewrites, v.review FROM lp_versions v
     JOIN projects p ON p.id = v.project_id
     WHERE p.demo = 0 AND p.kind = 'tool' AND v.tool_model IS NOT NULL
       AND v.version = (SELECT MIN(version) FROM lp_versions w WHERE w.project_id = v.project_id AND w.tool_model IS NOT NULL)`,
  ).all() as { project_id: number; tool_model: string; tool_rewrites: number | null; review: string | null }[];
  const models = [...new Set(firsts.map((f) => f.tool_model))];
  const pass = models.map((m) => {
    const mine = firsts.filter((f) => f.tool_model === m);
    const ok = mine.filter((f) => (f.tool_rewrites ?? 0) === 0 && (JSON.parse(f.review ?? "{}") as { ok?: boolean }).ok).length;
    return { modelId: m, value: ok / mine.length, n: mine.length, display: `${Math.round((ok / mine.length) * 100)}%（${ok}/${mine.length}）` };
  });
  const use = models.map((m) => {
    const t = firsts.filter((f) => f.tool_model === m).map((f) => projectTotals(f.project_id)).filter((x) => x.visits > 0);
    const v = t.reduce((n, x) => n + x.visits, 0);
    const c = t.reduce((n, x) => n + x.signups, 0);
    return v ? { modelId: m, value: c / v, n: t.length, display: `${(c / v * 100).toFixed(1)}%（${t.length}件）` } : null;
  }).filter((x): x is NonNullable<typeof x> => !!x);
  const cost = (db().prepare("SELECT model_id AS m, SUM(cost_usd) AS usd FROM ai_calls WHERE purpose = 'ツール作成' AND error IS NULL GROUP BY model_id").all() as { m: string; usd: number }[])
    .map((r) => {
      const n = firsts.filter((f) => f.tool_model === r.m).length;
      return n ? { modelId: r.m, value: (r.usd * s.usdJpy) / n, n, display: `${Math.round((r.usd * s.usdJpy) / n)}円` } : null;
    }).filter((x): x is NonNullable<typeof x> => !!x);
  return [
    { key: "tool-pass", title: "ツールの出来", question: "最初に書いたコードが、手直しなしで自動テストとAIのチェックを通った割合", better: "high", max: 1, empty: "ツールを作ると、たまっていきます", rows: rank(pass, "high") },
    { key: "tool-use", title: "ツールの利用率", question: "そのAIがコードを書いたツールで、訪問者のうち実際に使った人の割合", better: "high", empty: "公開したツールに訪問者が来ると、たまっていきます", rows: rank(use, "high") },
    { key: "tool-cost", title: "ツール1件のコードの費用", question: "ツールのコードを書く（直す分も含む）のにかかった費用の平均（安いほど上）", better: "low", empty: "ツールを作ると、たまっていきます", rows: rank(cost, "low") },
  ];
}

// LPのデザインのAIの作り比べ: 2案を作った回ごとに、各AIが選ばれた回数・3社の採点の平均点・作っていない会社の採点だけの平均点
export function designModelEffect(): { modelId: string; n: number; won: number; avg: number | null; neutral: number | null }[] {
  const rows = db().prepare(
    `SELECT c.project_id, c.version, c.id, c.model, c.selected, c.score, c.judges FROM page_candidates c
     JOIN projects p ON p.id = c.project_id
     WHERE c.model IS NOT NULL AND p.demo = 0 ORDER BY c.id`,
  ).all() as { project_id: number; version: number; id: number; model: string; selected: number; score: number | null; judges: string | null }[];
  const rounds = new Map<string, typeof rows>();
  for (const r of rows) rounds.set(`${r.project_id}-${r.version}`, [...(rounds.get(`${r.project_id}-${r.version}`) ?? []), r]);
  const acc = new Map<string, { n: number; won: number; scores: number[]; neutral: number[] }>();
  for (const pair of rounds.values()) {
    if (pair.length !== 2) continue;
    const judges = pair[0].judges ? (JSON.parse(pair[0].judges) as { modelId: string; a: number; b: number }[]) : [];
    pair.forEach((c, i) => {
      const m = acc.get(c.model) ?? { n: 0, won: 0, scores: [], neutral: [] };
      m.n++;
      m.won += c.selected;
      if (c.score !== null) m.scores.push(c.score);
      const company = modelInfo(c.model).provider;
      for (const j of judges) if (modelInfo(j.modelId).provider !== company) m.neutral.push(i === 0 ? j.a : j.b);
      acc.set(c.model, m);
    });
  }
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  return [...acc].map(([modelId, m]) => ({ modelId, n: m.n, won: m.won, avg: mean(m.scores), neutral: mean(m.neutral) }))
    .sort((x, y) => y.won / y.n - x.won / x.n || (y.avg ?? 0) - (x.avg ?? 0));
}

// 以前の比べ方（参考なし・参考ありの2案）の結果
export function refEffect() {
  const rows = db().prepare(
    `SELECT a.score AS plain, b.score AS refs, b.selected AS refsWon FROM page_candidates a
     JOIN page_candidates b ON b.project_id = a.project_id AND b.version = a.version AND b.with_refs = 1
     WHERE a.with_refs = 0 AND a.model IS NULL`,
  ).all() as { plain: number | null; refs: number | null; refsWon: number }[];
  const n = rows.length;
  const avg = (k: "plain" | "refs") => (n ? rows.reduce((s, r) => s + (r[k] ?? 0), 0) / n : null);
  return { n, refsWon: rows.filter((r) => r.refsWon).length, avgPlain: avg("plain"), avgRefs: avg("refs") };
}
