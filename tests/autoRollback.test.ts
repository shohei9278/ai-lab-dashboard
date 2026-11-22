import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import { db, type ProjectRow } from "../src/lib/db";
import { autoRollback, rollbackPlan } from "../src/lib/rollback";

// 公開後の自動の巻き戻し: 新しく公開したツールの版で、来た人の画面のエラーが前の版より増えたら、前の版に戻す

const conn = () => db();
const today = () => (conn().prepare("SELECT date('now', '+9 hours') AS d").get() as { d: string }).d;
const daysAgo = (n: number) => (conn().prepare("SELECT date('now', '+9 hours', ?) AS d").get(`-${n} days`) as { d: string }).d;

function setup(opts: { newErrors: number; newVisits: number; prevErrors?: number; prevVisits?: number; firstDay?: string } ) {
  const id = Number(conn().prepare("INSERT INTO projects (title, target, problem, solution, hypothesis, ai_reason, stage, model_id, kind, lp, lp_version, public_version, public_slug) VALUES ('t', 't', 'p', 's', 'h', 'r', 'live', 'claude', 'tool', ?, 2, 2, 'slug-t')").run(JSON.stringify({ headline: "第2版" })).lastInsertRowid);
  const ver = conn().prepare("INSERT INTO lp_versions (project_id, version, lp, note) VALUES (?, ?, ?, ?)");
  ver.run(id, 1, JSON.stringify({ headline: "第1版" }), "最初の版");
  ver.run(id, 2, JSON.stringify({ headline: "第2版" }), "改善");
  const m = conn().prepare("INSERT INTO metrics (project_id, day, visits, signups, ad_spend_jpy, source, lp_version) VALUES (?, ?, ?, 0, 0, 'real', ?)");
  m.run(id, daysAgo(10), opts.prevVisits ?? 10, 1);
  m.run(id, opts.firstDay ?? today(), opts.newVisits, 2);
  const err = conn().prepare("INSERT INTO lp_funnel (project_id, version, name, detail, visitors) VALUES (?, ?, 'tool_error', 'TypeError.L12', ?)");
  if (opts.prevErrors) err.run(id, 1, opts.prevErrors);
  if (opts.newErrors) err.run(id, 2, opts.newErrors);
  return id;
}
const project = (id: number) => conn().prepare("SELECT * FROM projects WHERE id = ?").get(id) as ProjectRow;
const events = (id: number, kind: string) => (conn().prepare("SELECT message FROM events WHERE project_id = ? AND kind = ?").all(id, kind) as { message: string }[]).map((r) => r.message);

test("巻き戻し: 新しい版でエラーが人数・割合ともに増えたら、前の版を公開し直して記録する", async () => {
  const id = setup({ newErrors: 3, newVisits: 5, prevErrors: 0, prevVisits: 10 });
  assert.deepEqual(rollbackPlan(project(id)), { from: 2, to: 1, errors: 3, visits: 5, prevErrors: 0, prevVisits: 10 });
  const published: ProjectRow[] = [];
  const publish = async (p: ProjectRow) => {
    published.push(p);
    conn().prepare("UPDATE projects SET public_version = ? WHERE id = ?").run(p.lp_version, p.id);
    return true;
  };
  assert.equal(await autoRollback(project(id), publish), true);
  assert.equal(published.length, 1);
  assert.equal(JSON.parse(published[0].lp!).headline, "第1版");
  const after = project(id);
  assert.deepEqual([after.lp_version, after.public_version], [1, 1]);
  assert.match(events(id, "auto-rollback")[0], /第2版.*5人中3人.*第1版に自動で戻しました/);
  assert.match((conn().prepare("SELECT note FROM lp_versions WHERE project_id = ? AND version = 2").get(id) as { note: string }).note, /自動で取り下げ/);
  // 30日のあいだは、もう一度は戻さない（行ったり来たりしない）
  conn().prepare("UPDATE projects SET lp_version = 2, public_version = 2 WHERE id = ?").run(id);
  assert.equal(rollbackPlan(project(id)), null);
});

test("巻き戻し: 1人だけ・割合が低い・前の版でも同じくらい・7日を過ぎた・未公開の新しい版がある、のときは戻さない", () => {
  assert.equal(rollbackPlan(project(setup({ newErrors: 1, newVisits: 2 }))), null);
  assert.equal(rollbackPlan(project(setup({ newErrors: 2, newVisits: 10 }))), null);
  assert.equal(rollbackPlan(project(setup({ newErrors: 3, newVisits: 5, prevErrors: 6, prevVisits: 10 }))), null);
  assert.equal(rollbackPlan(project(setup({ newErrors: 3, newVisits: 5, firstDay: daysAgo(8) }))), null);
  const draft = setup({ newErrors: 3, newVisits: 5 });
  conn().prepare("UPDATE projects SET lp_version = 3 WHERE id = ?").run(draft);
  assert.equal(rollbackPlan(project(draft)), null);
  // LP（ツールでない）は対象にしない
  const lp = setup({ newErrors: 3, newVisits: 5 });
  conn().prepare("UPDATE projects SET kind = 'lp' WHERE id = ?").run(lp);
  assert.equal(rollbackPlan(project(lp)), null);
});

test("巻き戻し: 公開できなかったら、手元の版も元に戻して記録する", async () => {
  const id = setup({ newErrors: 3, newVisits: 5 });
  assert.equal(await autoRollback(project(id), async () => { throw new Error("つながらない"); }), false);
  const after = project(id);
  assert.deepEqual([after.lp_version, after.public_version, JSON.parse(after.lp!).headline], [2, 2, "第2版"]);
  assert.match(events(id, "rollback-error")[0], /公開できませんでした: つながらない/);
  assert.deepEqual(events(id, "auto-rollback"), []);
});
