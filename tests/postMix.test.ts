import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import { db, getSettings } from "../src/lib/db";

// 投稿の場所と数（運営者が決めた）: 費用は1成果あたりで比べ、X を費用だけで避けない。数は成績から朝会のAIが決め、場所ごとの理由を残す

const pid = () => Number(db().prepare("INSERT INTO projects (title, target, problem, solution, hypothesis, ai_reason, stage, model_id, kind, published_at, public_slug) VALUES ('雪玉', 't', 'p', 's', 'h', 'r', 'live', 'claude', 'tool', datetime('now', '-5 days'), ?)").run(`mix-${Math.random().toString(36).slice(2, 8)}`).lastInsertRowid);
const post = (project: number, platform: string, visits: number, conversions: number, daysAgo = 1) =>
  db().prepare("INSERT INTO sns_posts (project_id, platform, code, text, author, status, posted_at, visits, conversions) VALUES (?, ?, ?, 't', 'ai', 'posted', datetime('now', ?), ?, ?)")
    .run(project, platform, `c-${Math.random().toString(36).slice(2, 10)}`, `-${daysAgo} days`, visits, conversions);

test("場所ごとの成績: 1投稿あたりの訪問・成果と、1成果あたりの費用を、直近14日とこれまでで出す", async () => {
  const { platformCostText } = await import("../src/lib/plan");
  db().exec("DELETE FROM sns_posts");
  const p = pid();
  post(p, "x", 1, 1); post(p, "x", 1, 0); // X: 2件・訪問2・成果1
  for (let i = 0; i < 4; i++) post(p, "threads", 3, 0); // Threads: 4件・訪問12・成果0
  post(p, "x", 5, 2, 30); // 30日前（これまでにだけ入る）
  const t = platformCostText();
  const jpy = Math.round(0.2 * 2 * getSettings().usdJpy);
  assert.match(t, new RegExp(`直近14日: [^\\n]*X 2件・訪問2人（1投稿あたり1\\.0人）・成果1人（1投稿あたり0\\.50人）・1成果 約${jpy}円`));
  assert.match(t, /直近14日: [^\n]*Threads 4件・訪問12人（1投稿あたり3\.0人）・成果0人（1投稿あたり0\.00人）・無料/);
  assert.match(t, /これまで: [^\n]*X 3件・訪問7人/);
  db().exec("DELETE FROM sns_posts");
  assert.match(platformCostText(), /まだ投稿がない/);
});

test("朝会: 費用は1成果あたりで比べ、X を費用だけで避けない。週3件の上限はない。場所ごとの数と理由（post_mix）を残す", async () => {
  const { createPlan, todayPlan } = await import("../src/lib/plan");
  db().exec("DELETE FROM daily_plans; DELETE FROM sns_posts");
  post(pid(), "x", 2, 1);
  let system = "";
  let user = "";
  const ask = async <T,>(o: { purpose: string; system: string; user: string; validate: (v: unknown) => v is T }): Promise<T> => {
    let v: unknown;
    if (o.purpose === "毎日の計画") {
      system = o.system;
      user = o.user;
      v = { bottleneck: "reach", evidence: "e", certainty: "low", review: "r", focus: "f", goals: [], post_mix: "X 宣伝3（1投稿あたりの成果がいちばん高い）/ Threads 宣伝1（成果が出ていないので減らす）", pause_new: false, pause_reason: "", idea_note: "", research: null, tasks: [] };
    } else if (o.purpose === "朝会（意見）") v = { opinion: "意見" };
    else if (o.purpose === "投稿の切り口の分類") v = { types: [] };
    else throw new Error(`想定していない呼び出し: ${o.purpose}`);
    assert.ok(o.validate(v), o.purpose);
    return v as T;
  };
  const keys = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY"];
  const before = keys.map((k) => process.env[k]);
  keys.forEach((k) => (process.env[k] = "test-dummy"));
  try {
    await createPlan({ force: true, ask: ask as never, weather: async () => [] });
  } finally {
    keys.forEach((k, i) => (before[i] === undefined ? delete process.env[k] : (process.env[k] = before[i])));
  }
  assert.doesNotMatch(system, /リンク付きの投稿が高い/);
  assert.doesNotMatch(system, /週3件まで試してよい/);
  assert.match(system, /1訪問あたりではなく1成果あたりで比べる/);
  assert.match(system, /数に決まりはない/);
  assert.match(user, /場所ごとの宣伝の投稿の成績[^]*1成果 約/);
  const content = JSON.parse(todayPlan()!.content) as { post_mix?: string };
  assert.match(content.post_mix ?? "", /X 宣伝3/);
});
