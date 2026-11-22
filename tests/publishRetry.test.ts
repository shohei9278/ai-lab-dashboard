import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import { db } from "../src/lib/db";
import { PUBLISH_FAILING_SQL, UNCLOSED_SQL, UNPUBLISHED_SQL, retryFailedPublishing } from "../src/lib/loop";
import { waitingItems } from "../src/lib/overview";

// 提案箱 #84: 公開・受付終了に失敗したまま残った案件を、やり直し、失敗が続けば運営者に見せる
const add = (stage: string, slug: string | null, demo = 0) => Number(db().prepare(
  "INSERT INTO projects (title, target, problem, solution, hypothesis, ai_reason, stage, model_id, kind, lp, lp_version, public_slug, demo) VALUES ('t', 't', 'p', 's', 'h', 'r', ?, 'claude', 'lp', '{}', 1, ?, ?)",
).run(stage, slug, demo).lastInsertRowid);
const ev = (id: number, kind: string) => db().prepare("INSERT INTO events (project_id, actor, kind, message) VALUES (?, 'system', ?, 'm')").run(id, kind);
const ids = (where: string) => (db().prepare(`SELECT id FROM projects p WHERE ${where} ORDER BY id`).all() as { id: number }[]).map((r) => r.id);

test("公開に失敗して集客中・保留中のまま載っていない案件と、撤退して受付を終えていない案件を拾う", () => {
  const live = add("live", null);
  const hold = add("hold", null);
  const ok = add("live", "p-ok");
  const demo = add("live", null, 1);
  const killedOpen = add("killed", "p-open");
  ev(killedOpen, "publish");
  const killedClosed = add("killed", "p-closed");
  ev(killedClosed, "publish");
  ev(killedClosed, "close");
  const never = add("killed", null);
  const un = ids(UNPUBLISHED_SQL);
  assert.ok(un.includes(live) && un.includes(hold));
  assert.ok(!un.includes(ok) && !un.includes(demo) && !un.includes(never));
  const uc = ids(UNCLOSED_SQL);
  assert.ok(uc.includes(killedOpen));
  assert.ok(!uc.includes(killedClosed) && !uc.includes(never) && !uc.includes(ok));
});

test("やり直しでも失敗が続くもの（公開してからの失敗が2回以上）だけ、確認・対応に出す", () => {
  const once = add("live", null);
  ev(once, "publish-error");
  const twice = add("live", null);
  ev(twice, "publish-error");
  ev(twice, "publish-error");
  const closeFail = add("killed", "p-cf");
  ev(closeFail, "publish-error"); // 公開する前の失敗は数えない
  ev(closeFail, "publish");
  ev(closeFail, "publish-error");
  const closeFail2 = add("killed", "p-cf2");
  ev(closeFail2, "publish");
  ev(closeFail2, "publish-error");
  ev(closeFail2, "publish-error");
  const failing = ids(PUBLISH_FAILING_SQL);
  assert.ok(failing.includes(twice) && failing.includes(closeFail2));
  assert.ok(!failing.includes(once) && !failing.includes(closeFail));
  const w = waitingItems().filter((x) => x.kind === "publishFail").map((x) => x.projectId);
  assert.ok(w.includes(twice) && w.includes(closeFail2) && !w.includes(once));
});

test("やり直しは1時間に1回だけ（強制のときは毎回）。対象の案件の公開をもう一度試す", async () => {
  const id = add("live", null);
  const tries = () => (db().prepare("SELECT COUNT(*) AS n FROM events WHERE project_id = ? AND kind IN ('publish', 'publish-error')").get(id) as { n: number }).n;
  await retryFailedPublishing(true);
  const after = tries();
  assert.ok(after >= 1); // テストでは公開用サイトの設定がないので、公開の記録だけ残る
  await retryFailedPublishing();
  assert.equal(tries(), after); // 1時間たっていないので、やり直さない
});
