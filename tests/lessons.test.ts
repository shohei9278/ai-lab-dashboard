import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import { db, type LessonRow } from "../src/lib/db";
import { lessonLine } from "../src/lib/loop";
import { inactiveLessons, lessonStats, outcomeOfUse, recordIdeaLessons, recordPlanLessonEffects, restoreLesson, reviewableLessons, reviewLessons } from "../src/lib/lessons";

// 教訓が、どの判断に使われたかをたどる（11/26 に運営者が決めた）。教訓を見て判断を変えたときだけ残し、変えた先の結果とつなぎ、
// 結果の出た使い方が2件以上ある教訓は、定例会議で議長のAIが維持・直す・保留を決める

const clear = () => db().exec("DELETE FROM lesson_uses; DELETE FROM lessons");
const lesson = (text: string) => Number(db().prepare("INSERT INTO lessons (project_id, text, fact, interpretation, certainty) VALUES (NULL, ?, '事実', ?, 'low')").run(text, text).lastInsertRowid);
const project = (o: { stage?: string; growth?: number; hit?: number | null } = {}) =>
  Number(db().prepare("INSERT INTO projects (title, target, problem, solution, hypothesis, ai_reason, stage, model_id, kind, growth_phase, spread_hit) VALUES ('案', 't', 'p', 's', 'h', 'r', ?, 'claude', 'tool', ?, ?)").run(o.stage ?? "live", o.growth ?? 0, o.hit ?? null).lastInsertRowid);
const get = (id: number) => db().prepare("SELECT * FROM lessons WHERE id = ?").get(id) as LessonRow;

test("教訓: 番号つきで渡し、教訓を見て変えたときだけ（今使っている教訓・変えたことがあるものだけ）残す", () => {
  clear();
  const a = lesson("夜の投稿は反応が多い");
  const held = lesson("保留した教訓");
  db().prepare("UPDATE lessons SET active = 0, hold_reason = 'x' WHERE id = ?").run(held);
  assert.match(lessonLine(get(a)), new RegExp(`^- 【教訓${a}】\\[確かさ:`));
  const p = project();
  const n = recordPlanLessonEffects([
    { lesson_ids: [a], project_id: p, what: "promo", change: "宣伝を夜に寄せた" },
    { lesson_ids: [a, held, 99999], project_id: p, what: "improve", change: "冒頭の説明を短くした" }, // 保留・ない番号は残さない
    { lesson_ids: [a], project_id: p, what: "trial", change: "" }, // 変えたことがなければ残さない
    { lesson_ids: [a], project_id: p, what: "idea", change: "朝会はアイデアの使い方を書かない" }, // 朝会の idea は other にする
  ], { modelId: "claude" });
  assert.equal(n, 3);
  assert.equal(recordIdeaLessons([{ id: a, change: "対象を夜に使う人にした" }, { id: held, change: "x" }, { id: a }], p, "gpt"), 1);
  const kinds = (db().prepare("SELECT kind FROM lesson_uses ORDER BY id").all() as { kind: string }[]).map((r) => r.kind);
  assert.deepEqual(kinds, ["promo", "improve", "other", "idea"]);
});

test("教訓: 使い方を、変えた先の結果につなぐ（結果がまだ・判断できなかったものは、効いたとも効かなかったとも数えない）", () => {
  clear();
  const at = new Date(Date.now() - 60_000).toISOString().slice(0, 19).replace("T", " ");
  // ページの直し: 使ったあとにできた版の答え合わせ
  const p1 = project();
  assert.equal(outcomeOfUse({ at, project_id: p1, kind: "improve" }), "pending");
  db().prepare("INSERT INTO lp_versions (project_id, version, lp, note, improve_check, check_verdict) VALUES (?, 2, '{}', '自動改善', '{}', 'better')").run(p1);
  assert.equal(outcomeOfUse({ at, project_id: p1, kind: "improve" }), "good");
  db().prepare("UPDATE lp_versions SET check_verdict = 'flat' WHERE project_id = ?").run(p1);
  assert.equal(outcomeOfUse({ at, project_id: p1, kind: "improve" }), "unclear");
  // 試し: 判定待ちはまだ、勝ちは良かった
  const p2 = project();
  db().prepare("INSERT INTO plan_trials (plan_id, project_id, created_at, question, change, metric, judge_at, hours, min_visits) VALUES (1, ?, datetime('now'), 'q', 'c', 'visits', datetime('now', '+2 days'), 48, 20)").run(p2);
  assert.equal(outcomeOfUse({ at, project_id: p2, kind: "trial" }), "pending");
  db().prepare("UPDATE plan_trials SET status = 'done', verdict = 'lose' WHERE project_id = ?").run(p2);
  assert.equal(outcomeOfUse({ at, project_id: p2, kind: "trial" }), "bad");
  // アイデア: 育てる段階・当たりは良かった、撤退・外れは悪かった、公開中はまだ
  assert.equal(outcomeOfUse({ at, project_id: project({ growth: 1 }), kind: "idea" }), "good");
  assert.equal(outcomeOfUse({ at, project_id: project({ stage: "killed" }), kind: "idea" }), "bad");
  assert.equal(outcomeOfUse({ at, project_id: project({ hit: 0 }), kind: "idea" }), "bad");
  assert.equal(outcomeOfUse({ at, project_id: project(), kind: "idea" }), "pending");
  // 投稿などは結果を測れない
  assert.equal(outcomeOfUse({ at, project_id: p1, kind: "promo" }), "none");
});

test("教訓の見直し: 結果の出た使い方が2件以上ある教訓だけを議長に渡し、維持・直す・保留を残す。運営者は保留を戻せる", async () => {
  clear();
  const keep = lesson("維持する教訓");
  const fix = lesson("直す教訓");
  const hold = lesson("保留する教訓");
  const few = lesson("結果が1件だけの教訓");
  const good = project({ growth: 1 });
  const bad = project({ stage: "killed" });
  for (const id of [keep, fix, hold]) {
    recordIdeaLessons([{ id, change: "a" }], good, "gpt");
    recordIdeaLessons([{ id, change: "b" }], bad, "gpt");
  }
  recordIdeaLessons([{ id: few, change: "c" }], good, "gpt");
  recordIdeaLessons([{ id: few, change: "d" }], project(), "gpt"); // まだ
  assert.deepEqual(reviewableLessons().map((x) => x.lesson.id), [keep, fix, hold]);
  assert.deepEqual([lessonStats().get(few)?.good, lessonStats().get(few)?.pending], [1, 1]);
  let seen = "";
  const ask = (async (o: { user: string }) => {
    seen = o.user;
    return { reviews: [
      { id: keep, action: "keep", why: "良かった1・悪かった1で、まだ決めるほどの差がない" },
      { id: fix, action: "revise", why: "悪かった1件は対象が違った", fact: "f", interpretation: "条件を足した教訓", unknown: "u", certainty: "mid" },
      { id: hold, action: "hold", why: "悪かった方が多い" },
      { id: few, action: "hold", why: "対象でない教訓は変えない" },
    ] };
  }) as unknown as Parameters<typeof reviewLessons>[1];
  const r = await reviewLessons("claude", ask);
  assert.deepEqual(r, { kept: 1, revised: 1, held: 1 });
  assert.match(seen, new RegExp(`【教訓${keep}】.*\\n  使われた 2回: 良かった1・悪かった1・判断できなかった0・まだ0`));
  assert.doesNotMatch(seen, new RegExp(`【教訓${few}】`));
  assert.equal(get(keep).active, 1);
  assert.equal(get(few).active, 1); // 対象でない教訓は変えない
  const h = get(hold);
  assert.deepEqual([h.active, h.hold_reason], [0, "悪かった方が多い"]);
  const f = get(fix);
  assert.equal(f.active, 0);
  const nf = get(f.replaced_by!);
  assert.deepEqual([nf.active, nf.interpretation, nf.certainty, nf.revised_from], [1, "条件を足した教訓", "mid", fix]);
  assert.deepEqual(inactiveLessons().map((l) => l.id).sort(), [fix, hold].sort());
  // 保留は戻せる。直して置き換えた教訓は戻さない（新しい教訓と2つになるため）
  assert.equal(restoreLesson(hold), true);
  assert.equal(get(hold).active, 1);
  assert.equal(restoreLesson(fix), false);
});

test("教訓の見直し: 対象の教訓がなければ、AIを呼ばない", async () => {
  clear();
  lesson("使われていない教訓");
  let called = false;
  const ask = (async () => { called = true; return { reviews: [] }; }) as unknown as Parameters<typeof reviewLessons>[1];
  assert.deepEqual(await reviewLessons("claude", ask), { kept: 0, revised: 0, held: 0 });
  assert.equal(called, false);
});
