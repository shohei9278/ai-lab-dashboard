import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import { db } from "../src/lib/db";

const post = async (body: Record<string, unknown>) => {
  const { POST } = await import("../src/app/api/loop/route");
  return POST(new Request("http://localhost/api/loop", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
};
const g = globalThis as unknown as { __aiLabIdeaRun?: string };

test("アイデア出しのボタン: 受け付けたらすぐ返し、会議は裏で進める。失敗は経過に残す", async () => {
  // 会議は失敗する（テストではAIのキーがない）が、待たないので「受け付けました」が返る（前の作りでは、会議の失敗がそのまま返っていた）
  const res = await post({ action: "ideas", theme: "", count: 1 });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { accepted: true });
  // テストではAIのキーがないので、裏の会議は「どのAIからも〜」で終わり、経過に残る
  for (let i = 0; i < 50 && !db().prepare("SELECT 1 FROM events WHERE kind = 'background-error'").get(); i++) await new Promise((ok) => setTimeout(ok, 100));
  const ev = db().prepare("SELECT message FROM events WHERE kind = 'background-error' ORDER BY id DESC").get() as { message: string } | undefined;
  assert.match(ev?.message ?? "", /アイデア出しに失敗しました/);
});

test("アイデア出しのボタン: ほかのアイデア出しが動いている間は、受け付けずに理由を返す。選べない組み合わせもすぐ返す", async () => {
  g.__aiLabIdeaRun = "毎日のアイデア出し";
  try {
    for (const action of ["ideas", "daily"]) {
      const res = await post({ action, count: 1 });
      assert.equal(res.status, 400);
      assert.match((await res.json()).error, /いま「毎日のアイデア出し」が動いています/);
    }
  } finally {
    g.__aiLabIdeaRun = undefined;
  }
  const res = await post({ action: "ideas", count: 1, deep: true, aim: "demand" });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /じっくり案件では、需要を確かめる/);
});

test("遊ぶ様子の動画のボタン: 動くツールでない案件は、すぐ理由を返す", async () => {
  const id = Number(db().prepare("INSERT INTO projects (title, target, problem, solution, hypothesis, ai_reason, stage, model_id, kind) VALUES ('t', 't', 'p', 's', 'h', 'r', 'live', 'claude', 'lp')").run().lastInsertRowid);
  const res = await post({ action: "play-video", projectId: id });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /動くツールの案件だけ/);
});
