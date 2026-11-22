import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import { db, getSettings, saveSettings } from "../src/lib/db";
import { showcaseNumbers } from "../src/lib/showcaseNumbers";
import { GET } from "../src/app/api/showcase/numbers/route";

test("公開の数字: 概要ページを出す設定のときだけ、どのサイトからでも読める", async () => {
  saveSettings({ ...getSettings(), showcaseEnabled: false });
  assert.equal((await GET()).status, 404);
  saveSettings({ ...getSettings(), showcaseEnabled: true });
  const res = await GET();
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("access-control-allow-origin"), "*");
  const body = (await res.json()) as { totals: { ideas: number } };
  assert.equal(typeof body.totals.ideas, "number");
});

test("公開の数字: 数と短い区分だけを返し、提案や案件の題・中身は入れない", () => {
  db().prepare("INSERT INTO plan_requests (title, how, why, source, target, status) VALUES ('ひみつの題', 'ひみつの中身', 'ひみつの理由', 'scene', 'system', 'done')").run();
  db().prepare("INSERT INTO plan_requests (title, how, source, target, status, note) VALUES ('返事なしの題', 'h', 'scene', 'system', 'declined', '30日返事がなかったので、自動で見送り')").run();
  const n = showcaseNumbers();
  const json = JSON.stringify(n);
  assert.ok(!json.includes("ひみつ"));
  assert.ok(n.improvements.aiDone >= 1);
  assert.ok(n.improvements.human > 0);
  assert.deepEqual(n.staff.map((m) => m.id).sort(), ["anthropic", "google", "openai"]);
  assert.ok(n.operations.some((o) => o.label === "AIの提案を承認・却下"));
});
