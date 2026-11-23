import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import { db } from "../src/lib/db";
import { pngSize, toolShotFile, uploadToolShot } from "../src/lib/publish";
import { normalizeLp } from "../lp-site/src/lp/content";
import { firstShotNote } from "../src/lib/toolTest";

const base = { headline: "見出し", subheadline: "補足", pains: ["悩み"], features: [{ title: "特徴", body: "説明" }], cta: "使う", faq: [] };
const SB = "https://abcd1234.supabase.co/storage/v1/object/public/lp-images/p1/v1-shot-0a1b2c3d.png";

test("ツールの画面: 公開用の保存領域の写真だけを受け取り、大きさがおかしいものは落とす", () => {
  assert.deepEqual(normalizeLp({ ...base, shot: { url: SB, width: 750, height: 1624 } }).shot, { url: SB, width: 750, height: 1624 });
  assert.equal(normalizeLp({ ...base, shot: { url: "https://example.com/a.png", width: 750, height: 1624 } }).shot, undefined);
  assert.equal(normalizeLp({ ...base, shot: { url: "https://abcd.supabase.co/rest/v1/lps", width: 750, height: 1624 } }).shot, undefined);
  assert.equal(normalizeLp({ ...base, shot: { url: SB, width: 0, height: 1624 } }).shot, undefined);
  assert.equal(normalizeLp({ ...base, shot: { url: SB, width: 7.5, height: 1624 } }).shot, undefined);
  assert.equal(normalizeLp({ ...base, shot: { url: `${SB}${"x".repeat(500)}`, width: 750, height: 1624 } }).shot, undefined);
  assert.equal(normalizeLp(base).shot, undefined);
});

test("ツールの画面: 何も押す前の1画面だけを使い、押したあとの写真や紹介ページの確かめの版は使わない", () => {
  const p = Number(db().prepare("INSERT INTO projects (title, target, problem, solution, hypothesis, ai_reason, stage, model_id, kind) VALUES ('t', 't', 'p', 's', 'h', 'r', 'live', 'claude', 'tool')").run().lastInsertRowid);
  const v = db().prepare("INSERT INTO lp_versions (project_id, version, lp, test) VALUES (?, ?, '{}', ?)");
  v.run(p, 1, JSON.stringify({ ok: true, screenshot: "p1-v1.png", firstShot: "p1-v1-first.png" }));
  v.run(p, 2, JSON.stringify({ ok: true, screenshot: "p1-v2.png" }));
  v.run(p, 3, JSON.stringify({ kind: "page", ok: true, pc: "page.png" }));
  v.run(p, 4, JSON.stringify({ ok: true, firstShot: "../etc/passwd" }));
  assert.equal(toolShotFile(p, 1), "p1-v1-first.png");
  assert.equal(toolShotFile(p, 2), null);
  assert.equal(toolShotFile(p, 3), null);
  assert.equal(toolShotFile(p, 4), null);
  assert.equal(toolShotFile(p, 9), null);
});

test("ツールの画面: PNG の大きさを読み、PNG でなければ null", () => {
  const head = Buffer.alloc(24);
  head.writeUInt32BE(0x89504e47, 0);
  head.writeUInt32BE(0x0d0a1a0a, 4);
  head.write("IHDR", 12, "ascii");
  head.writeUInt32BE(750, 16);
  head.writeUInt32BE(1624, 20);
  assert.deepEqual(pngSize(head), { width: 750, height: 1624 });
  assert.equal(pngSize(Buffer.from("not a png at all, just some text")), null);
});

test("ツールの画面: ツールでない案件は上げない", async () => {
  assert.equal(await uploadToolShot({ id: 1, kind: "lp" }, 1), null);
});

test("ツールの画面: 何も押す前の1画面を撮れなかった理由を、記録に残す一文にする（撮れたときは出さない）", () => {
  const t = { ok: true, errors: [], clicked: 1, changed: true, overflow: false, at: "2026-11-23T00:00:00Z" };
  assert.equal(firstShotNote({ ...t, firstShot: "p1-v1-first.png" }), null);
  assert.equal(firstShotNote({ ...t, skipped: "ブラウザがない" }), null);
  const note = firstShotNote({ ...t, firstShotError: "Timeout 10000ms exceeded" });
  assert.ok(note?.includes("撮れませんでした") && note.includes("Timeout 10000ms exceeded"), note ?? "");
});
