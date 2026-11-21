import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import { db, type ProjectRow } from "../src/lib/db";
import { adjustScores } from "../src/lib/weekly";
import { doneEffects, doneEffectsText } from "../src/lib/effects";
import { funnelText } from "../src/lib/funnel";

// 会議が過去に基づいて改善できるようにする（運営者が、会議が過去に基づいて改善しているか・意味があるかを尋ね、3つを足すと決めた）
// 1. 採点者ごとの甘さ・辛さをならす 2. やった改善の前後の数字を渡す 3. 前の版と今の版の数字を並べる

const jday = (t: number) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date(t));
const ago = (d: number) => jday(Date.now() - d * 86_400_000);

test("定例会議の採点: ほぼ全部に8点の採点者と、ほぼ全部に5点の採点者の甘さ・辛さをならして、差が付くようにする", () => {
  // 案A〜D。GPT は全部甘め、Gemini は全部辛め。ならす前は A〜C が同じ平均になる
  const items = [
    [{ who: "gpt", score: 9 }, { who: "gemini", score: 5 }], // A: 両方にとって良い
    [{ who: "gpt", score: 8 }, { who: "gemini", score: 5 }], // B
    [{ who: "gpt", score: 8 }, { who: "gemini", score: 4 }], // C: 両方にとって良くない
    [{ who: "gpt", score: 8 }, { who: "gemini", score: 5 }], // D
  ];
  const adj = adjustScores(items);
  assert.ok(adj[0] > adj[1] && adj[1] > adj[2], JSON.stringify(adj));
  // 全体の平均は変えない（ならすのは、採点者どうしの差だけ）
  const raw = items.flat().reduce((n, x) => n + x.score, 0) / 8;
  assert.ok(Math.abs(adj.reduce((n, x) => n + x, 0) / 4 - raw) < 1e-9);
  // 採点者ごとの点を1〜10に収めてから平均する（辛い採点者の10点は、ならすと10を超えるが、10で止める。PR #127 の ai-review の指摘）
  // 甘い採点者 a（10・10・10・7、平均9.25）と辛い採点者 b（1・1・1・10、平均3.25）。全体の平均は6.25
  // 4つ目の案: a の7点は 7-3=4、b の10点は 10+3=13 → 10。平均は (4+10)/2=7（先に平均してから収めると 8.5 になる）
  const edge = adjustScores([
    [{ who: "a", score: 10 }, { who: "b", score: 1 }],
    [{ who: "a", score: 10 }, { who: "b", score: 1 }],
    [{ who: "a", score: 10 }, { who: "b", score: 1 }],
    [{ who: "a", score: 7 }, { who: "b", score: 10 }],
  ]);
  assert.equal(edge[3], 7);
  // 2件しか採点していない採点者は、ならさない。点のない案は0点
  const few = adjustScores([[{ who: "a", score: 9 }], [{ who: "a", score: 7 }], []]);
  assert.deepEqual(few, [9, 7, 0]);
});

function project(kind: "tool" | "lp" = "tool", version = 2): ProjectRow {
  const id = Number(db().prepare("INSERT INTO projects (title, target, problem, solution, hypothesis, ai_reason, stage, model_id, kind, lp_version, public_version) VALUES ('t', 't', 'p', 's', 'h', 'r', 'live', 'claude', ?, ?, ?)").run(kind, version, version).lastInsertRowid);
  return db().prepare("SELECT * FROM projects WHERE id = ?").get(id) as ProjectRow;
}
const metric = (pid: number, day: string, visits: number, signups: number, version = 1) =>
  db().prepare("INSERT INTO metrics (project_id, day, visits, signups, source, lp_version) VALUES (?, ?, ?, ?, 'real', ?)").run(pid, day, visits, signups, version);

test("やった改善の答え合わせ: やった日の前7日と後の、1日あたりの訪問・成果を出す（案件の提案はその案件、ほかは全案件）", () => {
  db().exec("DELETE FROM plan_requests; DELETE FROM metrics");
  const a = project(), b = project();
  // 5日前にやった。前の7日は a が1日2人、後は1日6人。b は前後とも1日1人
  for (let d = 12; d >= 1; d--) { metric(a.id, ago(d), d > 5 ? 2 : 6, d > 5 ? 0 : 1); metric(b.id, ago(d), 1, 0); }
  const done = (title: string, daysAgo: number, projectId: number | null, source = "scene") =>
    db().prepare("INSERT INTO plan_requests (title, source, target, status, project_id, decided_at) VALUES (?, ?, 'system', 'done', ?, datetime('now', ?))").run(title, source, projectId, `-${daysAgo} days`);
  done("a の最初の画面を直す", 5, a.id);
  done("全体の投稿の時間を変える", 5, null);
  done("昨日やったこと", 1, null);
  done("敗者復活で作った", 5, null, "revival");
  done("ずっと前", 40, null);
  const xs = doneEffects();
  assert.deepEqual(xs.map((x) => x.title).sort(), ["a の最初の画面を直す", "全体の投稿の時間を変える", "昨日やったこと"].sort());
  const fa = xs.find((x) => x.projectId === a.id)!;
  assert.equal(fa.afterDays, 5);
  assert.deepEqual(fa.before, { visits: 14, conversions: 0 });
  assert.deepEqual(fa.after, { visits: 30, conversions: 5 });
  const all = xs.find((x) => x.title === "全体の投稿の時間を変える")!;
  assert.deepEqual(all.before, { visits: 21, conversions: 0 }); // a 14 + b 7
  const text = doneEffectsText();
  assert.match(text, new RegExp(`「a の最初の画面を直す」（仕組み・作業の途中で・.+にやった・#${a.id}）: 訪問 2\\.0 → 6\\.0・成果 0\\.0 → 1\\.0（後は5日分）`));
  assert.match(text, /「昨日やったこと」.+（後は1日分。まだ判断しない）/);
  assert.match(text, /1つの改善の効果とは言い切れない/);
  // 基準の時刻を渡すと、その時刻から見て選ぶ（10日前から見ると、5日前と1日前にやったものはまだ先のことなので入らない）
  assert.deepEqual(doneEffects(28, Date.now() - 10 * 86_400_000).map((x) => x.title), []);
  // 3日前から見ると、5日前にやったものは後が2日分
  const past = doneEffects(28, Date.now() - 3 * 86_400_000);
  assert.ok(!past.some((x) => x.title === "昨日やったこと"));
  assert.equal(past.find((x) => x.projectId === a.id)?.afterDays, 2);
});

test("前の版との比べ: 前の版の動きと、今の版で変えたことを並べる。今の版に訪問がなくても前の版は渡す", () => {
  const p = project("tool", 3);
  db().prepare("INSERT INTO lp_versions (project_id, version, lp, note) VALUES (?, 3, '{}', '最初の1手を書いた一行をツールの上に置いた')").run(p.id);
  // 第2版: 訪問11人・画面に入った11人・操作1人
  metric(p.id, ago(4), 11, 1, 2);
  db().prepare("INSERT INTO lp_funnel (project_id, version, name, detail, visitors) VALUES (?, 2, 'section_view', 'tool', 11)").run(p.id);
  // 第3版はまだ訪問なし
  const fresh = funnelText(p);
  assert.match(fresh, /今の版（第3版）はまだ訪問なし/);
  assert.match(fresh, /前の版（第2版・訪問11人）: 訪問した 11人（100%） → ツールが画面に入った 11人（100%） → ツールを操作した 1人（9%）/);
  assert.match(fresh, /第3版で変えたこと: 最初の1手を書いた一行をツールの上に置いた/);
  // 第3版に訪問が入ると、今の版の動きのあとに前の版を並べる
  metric(p.id, ago(1), 5, 2, 3);
  db().prepare("INSERT INTO lp_funnel (project_id, version, name, detail, visitors) VALUES (?, 3, 'section_view', 'tool', 5)").run(p.id);
  const both = funnelText(p);
  assert.match(both, /ページの中での動き（第3版・訪問者に対する割合）: 訪問した 5人（100%） → ツールが画面に入った 5人（100%） → ツールを操作した 2人（40%）/);
  assert.ok(both.indexOf("第3版・訪問者") < both.indexOf("前の版（第2版"));
  // 前の版がない案件では何も足さない
  const only = project("tool", 1);
  metric(only.id, ago(1), 3, 0, 1);
  assert.doesNotMatch(funnelText(only), /前の版/);
});
