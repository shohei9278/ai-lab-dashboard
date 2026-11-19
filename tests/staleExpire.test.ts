import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import { db } from "../src/lib/db";
import { expireStale, getProject } from "../src/lib/loop";
import { waitingItems } from "../src/lib/overview";

const lp = (v: number) => JSON.stringify({ headline: `第${v}版`, tool: { html: "<button>押す</button><script>1</script>", shareText: "s" } });
const project = (o: { stage: string; deep?: number; published?: boolean }) => {
  const id = Number(db().prepare(
    "INSERT INTO projects (title, target, problem, solution, hypothesis, ai_reason, stage, model_id, kind, deep, lp, lp_version, public_slug, public_version) VALUES ('t', 't', 'p', 's', 'h', 'r', ?, 'claude', 'tool', ?, ?, ?, ?, ?)",
  ).run(o.stage, o.deep ?? 0, lp(o.published ? 2 : 1), o.published ? 2 : 1, o.published ? "p1" : null, o.published ? 1 : null).lastInsertRowid);
  for (const v of o.published ? [1, 2] : [1]) db().prepare("INSERT INTO lp_versions (project_id, version, lp, note) VALUES (?, ?, ?, 'n')").run(id, v, lp(v));
  return id;
};
const pending = (id: number, kind: string, daysAgo: number) => Number(db().prepare(
  "INSERT INTO approvals (project_id, kind, proposal, reason, status, created_at) VALUES (?, ?, 'p', 'r', 'pending', datetime('now', ?))",
).run(id, kind, `-${daysAgo} days`).lastInsertRowid);
const status = (a: number) => (db().prepare("SELECT status FROM approvals WHERE id = ?").get(a) as { status: string }).status;

test("判断待ちの期限（運営者が見つけた）: じっくり案件の開発待ちは、期限が過ぎても見送らず、残りの日数も出さない", () => {
  const id = project({ stage: "lp", deep: 1 });
  const a = pending(id, "dev", 30);
  expireStale(7);
  assert.equal(status(a), "pending");
  assert.equal(getProject(id)!.stage, "lp");
  const w = waitingItems().find((x) => x.key === `a${a}`)!;
  assert.equal(w.daysLeft, null);
  assert.ok(w.daysWaiting >= 29);
});

test("判断待ちの期限: まだ公開していない案件は、今までどおり見送り。期限前のものはそのまま", () => {
  const id = project({ stage: "lp" });
  const a = pending(id, "publish", 8);
  const fresh = pending(project({ stage: "idea" }), "idea", 3);
  expireStale(7);
  assert.equal(status(a), "expired");
  assert.equal(getProject(id)!.stage, "rejected");
  assert.equal(status(fresh), "pending");
  assert.equal(waitingItems().find((x) => x.key === `a${fresh}`)!.daysLeft, 4);
});

test("判断待ちの期限: 公開中の案件の差し替えは、期限が過ぎたら公開中の版に戻して集客を続ける（見送りにしない）", () => {
  const id = project({ stage: "lp", published: true });
  const a = pending(id, "publish", 8);
  expireStale(7);
  assert.equal(status(a), "expired");
  const p = getProject(id)!;
  assert.equal(p.stage, "live");
  assert.equal(p.lp_version, 1);
  const ev = db().prepare("SELECT message FROM events WHERE project_id = ? AND kind = 'expired'").get(id) as { message: string };
  assert.match(ev.message, /公開中の第1版のまま集客を続けます/);
  // 公開中の案件の「判断」は、今までどおり保留して集客を続ける
  const live = project({ stage: "live", published: true });
  pending(live, "decision", 8);
  expireStale(7);
  assert.equal(getProject(live)!.stage, "live");
});
