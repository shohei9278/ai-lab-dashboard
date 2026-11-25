import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import { db, getSettings, saveSettings } from "../src/lib/db";
import { countByCurrent, currentModelId, getModel, modelInfo, MODELS } from "../src/lib/models";
import { chairFor } from "../src/lib/weekly";
import { scoreProvisional } from "../src/lib/provisionalScore";

// GPT を gpt-5.6-sol から gpt-6.2-sol に切り替えた（運営者が決めた）。古い ID が設定や記録に残っていても、止まらず・偏らずに動くこと

test("モデルの切り替え: 古い ID で呼ぶと代わりのモデルになり、過去の記録の表示は古い名前のまま", () => {
  assert.equal(MODELS.some((m) => m.id === "gpt-5.6-sol"), false);
  assert.equal(currentModelId("gpt-5.6-sol"), "gpt-6.2-sol");
  assert.equal(currentModelId("gemini-3.1-pro-preview"), "gemini-3.1-pro-preview");
  assert.equal(getModel("gpt-5.6-sol").id, "gpt-6.2-sol");
  assert.deepEqual([modelInfo("gpt-5.6-sol").label, modelInfo("gpt-5.6-sol").provider], ["GPT-5.6 Sol（旧）", "openai"]);
  assert.equal(modelInfo("gpt-6.2-sol").label, "GPT-6.2 Sol");
});

test("モデルの切り替え: 設定で古いモデルが選ばれたままでも、代わりのモデルとして読む", () => {
  const before = getSettings().loopModel;
  try {
    saveSettings({ loopModel: "gpt-5.6-sol" });
    assert.equal(getSettings().loopModel, "gpt-6.2-sol");
  } finally {
    saveSettings({ loopModel: before });
  }
});

test("モデルの切り替え: 交代の順番では、古い ID の回数も代わりのモデルの回数として数える（代わりのモデルが続けて選ばれない）", () => {
  assert.deepEqual([...countByCurrent([{ m: "gpt-5.6-sol", n: 3 }, { m: "gpt-6.2-sol", n: 1 }, { m: "claude-opus-5-5", n: 2 }])], [["gpt-6.2-sol", 4], ["claude-opus-5-5", 2]]);
  db().exec("DELETE FROM meetings");
  const ins = db().prepare("INSERT INTO meetings (period_start, period_end, chair_model, content) VALUES ('2026-11-01', '2026-11-07', ?, '{}')");
  for (const m of ["gpt-5.6-sol", "gpt-5.6-sol", "claude-opus-5-5", "gemini-3.1-pro-preview"]) ins.run(m);
  for (let i = 0; i < 10; i++) assert.notEqual(chairFor(["claude-opus-5-5", "gpt-6.2-sol", "gemini-3.1-pro-preview"]), "gpt-6.2-sol");
  db().exec("DELETE FROM meetings");
});

test("モデルの切り替え: 前の GPT が出した提案は、代わりの GPT にも採点させない（同じ会社の案をひいきしないように）", async () => {
  const KEYS = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY"];
  const before = KEYS.map((k) => process.env[k]);
  KEYS.forEach((k) => (process.env[k] = "test-dummy"));
  try {
    db().exec("DELETE FROM plan_requests");
    db().prepare("INSERT INTO plan_requests (title, how, why, target, source, scene, proposer, score, created_at) VALUES ('前のGPTの案', 'h', 'w', 'system', 'scene', 'ツールのチェック', 'gpt-5.6-sol', NULL, datetime('now', '-1 hours'))").run();
    const seen = new Map<string, string>();
    const ask = (async (o: { modelId: string; user: string }) => {
      seen.set(o.modelId, o.user);
      return { scores: [...o.user.matchAll(/【(P\d+)】/g)].map(([, id]) => ({ id, score: 6 })) };
    }) as never;
    await scoreProvisional({ material: "材料", ask });
    assert.equal(seen.has("gpt-6.2-sol"), false);
    assert.ok(seen.get("claude-opus-5-5")?.includes("前のGPTの案"));
    assert.ok(seen.get("gemini-3.1-pro-preview")?.includes("前のGPTの案"));
  } finally {
    KEYS.forEach((k, i) => (before[i] === undefined ? delete process.env[k] : (process.env[k] = before[i])));
    db().exec("DELETE FROM plan_requests");
  }
});
