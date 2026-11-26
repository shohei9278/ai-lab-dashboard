import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import { db, type LessonRow } from "../src/lib/db";
import { lessonLine } from "../src/lib/loop";
import { inactiveLessons, lessonStats, lessonsJson, outcomeOfUse, recordLessonUses, restoreLesson, reviewableLessons, reviewLessons } from "../src/lib/lessons";

// 教訓が、どの判断に使われたかをたどる（11/26 に運営者が決めた）。教訓を見て判断を変えたときだけ、変えた先の番号と一緒に残し、
// 結果を番号で引く。結果の出た使い方が2件以上ある教訓は、定例会議で議長のAIが維持・直す・保留を決める

const clear = () => db().exec("DELETE FROM lesson_uses; DELETE FROM lessons");
const lesson = (text: string) => Number(db().prepare("INSERT INTO lessons (project_id, text, fact, interpretation, certainty) VALUES (NULL, ?, '事実', ?, 'low')").run(text, text).lastInsertRowid);
const project = (o: { stage?: string; growth?: number; hit?: number | null } = {}) =>
  Number(db().prepare("INSERT INTO projects (title, target, problem, solution, hypothesis, ai_reason, stage, model_id, kind, growth_phase, spread_hit) VALUES ('案', 't', 'p', 's', 'h', 'r', ?, 'claude', 'tool', ?, ?)").run(o.stage ?? "live", o.growth ?? 0, o.hit ?? null).lastInsertRowid);
const get = (id: number) => db().prepare("SELECT * FROM lessons WHERE id = ?").get(id) as LessonRow;
const idea = (lessonId: number, projectId: number, change = "a") =>
  recordLessonUses([{ id: lessonId, change }], { allowed: new Set([lessonId]), scene: "アイデア出し", modelId: "gpt", projectId, kind: "idea", refId: projectId });

test("教訓: 番号つきで渡し、その回に渡した教訓で、変えたことがあるものだけを、変えた先ごとに1件残す", () => {
  clear();
  const a = lesson("夜の投稿は反応が多い");
  const b = lesson("渡していない教訓");
  assert.match(lessonLine(get(a)), new RegExp(`^- 【教訓${a}】\\[確かさ:`));
  const p = project();
  const shown = new Set([a]);
  const n = recordLessonUses([
    { id: a, change: "対象を夜に使う人にした" },
    { id: a, change: "同じ教訓をもう一度" }, // 同じ変えた先には1件だけ（PR #211 の ai-review の指摘）
    { id: b, change: "渡していない教訓は受け付けない" },
    { id: a, change: "" },
  ], { allowed: shown, scene: "アイデア出し", modelId: "gpt", projectId: p, kind: "idea", refId: p });
  assert.equal(n, 1);
  // 渡した教訓がない回（実験枠）は受け付けない
  assert.equal(recordLessonUses([{ id: a, change: "x" }], { allowed: new Set(), scene: "アイデア出し", modelId: "gpt", projectId: p, kind: "idea", refId: p }), 0);
  // 朝会の予定に付ける形: 渡した教訓・変えたことがあるものだけ
  assert.equal(lessonsJson([{ id: a, change: "宣伝を夜に寄せた" }, { id: b, change: "x" }, { id: a }], shown), JSON.stringify([{ id: a, change: "宣伝を夜に寄せた" }]));
  assert.equal(lessonsJson([{ id: b, change: "x" }], shown), null);
});

test("教訓: 結果は、変えた先の番号で引く（同じ案件の別の施策の結果を拾わない）。まだ・判断できなかったものは数えない", () => {
  clear();
  // ページの直し: 公開した版の番号で答え合わせを引く
  const p1 = project();
  db().prepare("INSERT INTO lp_versions (project_id, version, lp, note, improve_check, check_verdict) VALUES (?, 2, '{}', '自動改善', '{}', NULL), (?, 3, '{}', '別の改善', '{}', 'worse')").run(p1, p1);
  assert.equal(outcomeOfUse({ project_id: p1, kind: "improve", ref_id: 2 }), "pending"); // 第3版の結果を拾わない
  db().prepare("UPDATE lp_versions SET check_verdict = 'better' WHERE project_id = ? AND version = 2").run(p1);
  assert.equal(outcomeOfUse({ project_id: p1, kind: "improve", ref_id: 2 }), "good");
  db().prepare("UPDATE lp_versions SET check_verdict = 'flat' WHERE project_id = ? AND version = 2").run(p1);
  assert.equal(outcomeOfUse({ project_id: p1, kind: "improve", ref_id: 2 }), "unclear");
  assert.equal(outcomeOfUse({ project_id: p1, kind: "improve", ref_id: null }), "none");
  // 試し: その試しの番号で判定を引く
  const p2 = project();
  const ins = db().prepare("INSERT INTO plan_trials (plan_id, project_id, created_at, question, change, metric, judge_at, hours, min_visits, status, verdict) VALUES (1, ?, datetime('now'), 'q', 'c', 'visits', datetime('now', '+2 days'), 48, 20, ?, ?)");
  const other = Number(ins.run(p2, "done", "win").lastInsertRowid);
  const mine = Number(ins.run(p2, "open", null).lastInsertRowid);
  assert.equal(outcomeOfUse({ project_id: p2, kind: "trial", ref_id: mine }), "pending");
  assert.equal(outcomeOfUse({ project_id: p2, kind: "trial", ref_id: other }), "good");
  db().prepare("UPDATE plan_trials SET status = 'done', verdict = 'lose' WHERE id = ?").run(mine);
  assert.equal(outcomeOfUse({ project_id: p2, kind: "trial", ref_id: mine }), "bad");
  // アイデア: 育てる段階・当たりは良かった、撤退・外れは悪かった、公開中はまだ
  assert.equal(outcomeOfUse({ project_id: project({ growth: 1 }), kind: "idea", ref_id: null }), "good");
  assert.equal(outcomeOfUse({ project_id: project({ stage: "killed" }), kind: "idea", ref_id: null }), "bad");
  assert.equal(outcomeOfUse({ project_id: project({ hit: 0 }), kind: "idea", ref_id: null }), "bad");
  assert.equal(outcomeOfUse({ project_id: project(), kind: "idea", ref_id: null }), "pending");
  // 投稿などは結果を測れない
  assert.equal(outcomeOfUse({ project_id: p1, kind: "promo", ref_id: 1 }), "none");
});

test("教訓の見直し: 結果の出た使い方が2件以上ある教訓だけを渡し、維持・直す・保留と理由を残す。変な答えは使わない。運営者は保留を戻せる", async () => {
  clear();
  const keep = lesson("維持する教訓");
  const fix = lesson("直す教訓");
  const hold = lesson("保留する教訓");
  const odd = lesson("変な答えの教訓");
  const few = lesson("結果が1件だけの教訓");
  const good = project({ growth: 1 });
  const bad = project({ stage: "killed" });
  for (const id of [keep, fix, hold, odd]) {
    idea(id, good);
    idea(id, bad);
  }
  idea(few, good);
  idea(few, project());
  assert.deepEqual(reviewableLessons().map((x) => x.lesson.id), [keep, fix, hold, odd]);
  assert.deepEqual([lessonStats().get(few)?.good, lessonStats().get(few)?.pending], [1, 1]);
  let seen = "";
  const ask = (async (o: { user: string }) => {
    seen = o.user;
    return { reviews: [
      { id: keep, action: "keep", why: "良かった1・悪かった1で、まだ決めるほどの差がない" },
      { id: fix, action: "revise", why: "悪かった1件は対象が違った", fact: "f", interpretation: "条件を足した教訓", unknown: "u", certainty: "mid" },
      { id: hold, action: "hold", why: "悪かった方が多い" },
      { id: odd, action: "delete", why: "知らない決め方" }, // 使わない（維持としても数えない）
      { id: few, action: "hold", why: "対象でない教訓は変えない" },
    ] };
  }) as unknown as Parameters<typeof reviewLessons>[1];
  assert.deepEqual(await reviewLessons("claude", ask), { kept: 1, revised: 1, held: 1 });
  assert.match(seen, new RegExp(`【教訓${keep}】.*\\n  使われた 2回: 良かった1・悪かった1・判断できなかった0・まだ0`));
  assert.doesNotMatch(seen, new RegExp(`【教訓${few}】`));
  assert.deepEqual([get(keep).active, get(keep).review_note], [1, "維持: 良かった1・悪かった1で、まだ決めるほどの差がない"]);
  assert.deepEqual([get(odd).active, get(odd).reviewed_at], [1, null]);
  assert.equal(get(few).active, 1);
  const h = get(hold);
  assert.deepEqual([h.active, h.hold_reason], [0, "悪かった方が多い"]);
  const f = get(fix);
  assert.equal(f.active, 0);
  const nf = get(f.replaced_by!);
  assert.deepEqual([nf.active, nf.interpretation, nf.certainty, nf.revised_from], [1, "条件を足した教訓", "mid", fix]);
  const inactive = inactiveLessons();
  assert.deepEqual([inactive.held.map((l) => l.id), inactive.replaced.map((l) => l.id)], [[hold], [fix]]);
  // 維持した教訓は、新しい結果が出るまで見直さない
  assert.equal(reviewableLessons().some((x) => x.lesson.id === keep), false);
  // 保留は戻せる。直して置き換えた教訓は戻さない
  assert.equal(restoreLesson(hold), true);
  assert.equal(get(hold).active, 1);
  assert.equal(restoreLesson(fix), false);
  // 戻した教訓は、同じ根拠のまますぐ見直さない（結果の出た使い方が増えるまで。PR #211 の ai-review の指摘）
  assert.equal(reviewableLessons().some((x) => x.lesson.id === hold), false);
  // 戻す前に使っていた案件の結果が、戻したあとに出ても、見直しのきっかけになる（使った日時ではなく、結果の出た数で見る）
  const later = project();
  idea(hold, later, "戻す前に使った");
  assert.equal(reviewableLessons().some((x) => x.lesson.id === hold), false); // まだ結果が出ていない
  db().prepare("UPDATE projects SET stage = 'killed' WHERE id = ?").run(later);
  assert.equal(reviewableLessons().some((x) => x.lesson.id === hold), true);
  // 維持した教訓も、結果の出た使い方が増えたら、もう一度見直す
  idea(keep, project({ growth: 1 }), "維持したあとに使った");
  assert.equal(reviewableLessons().some((x) => x.lesson.id === keep), true);
});

test("教訓の見直し: 対象の教訓がなければ、AIを呼ばない", async () => {
  clear();
  lesson("使われていない教訓");
  let called = false;
  const ask = (async () => { called = true; return { reviews: [] }; }) as unknown as Parameters<typeof reviewLessons>[1];
  assert.deepEqual(await reviewLessons("claude", ask), { kept: 0, revised: 0, held: 0 });
  assert.equal(called, false);
});
