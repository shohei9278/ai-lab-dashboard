import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import { db } from "../src/lib/db";
import { SIMILAR, addProposal, mergeSimilarOpen, similarity } from "../src/lib/voices";
import { meetingMaterial } from "../src/lib/weekly";

// 提案箱に、題の言い方だけ変えた同じ提案が4件並んでいた。同じ趣旨の提案は入れずに回数を数え、すでに入ったものはまとめる（運営者が「提案の幅も広げる」と決めた）

// 本番の提案箱にあった、同じ趣旨の4件と、違う提案
const same = [
  { title: "表示順と中身の突き合わせ", how: "design.order に入っているセクション（例: beforeAfter）の中身がLPのデータにない場合は、生成時に order から外すか、チェック項目に加える" },
  { title: "order と中身の突き合わせ", how: "design.order に入っているセクション（今回は beforeAfter）に対応するデータが LP 本体にあるかを、公開前に自動で照合する。ない場合は order から外すか、警告を出す" },
  { title: "design.orderと中身の突き合わせ", how: "order に beforeAfter が入っているのに、LPに beforeAfter の中身がない。order に入っている項目の中身があるかを、生成時に自動で確かめるようにする" },
  { title: "表示順と中身の照合", how: "design.orderに並べた区画ごとに、LP本体にその中身があるかを生成時に確かめ、なければorderから外すか中身を作る" },
];
const others = [
  { title: "再生系の停止処理の確認を標準化", how: "setInterval やアニメーションを持つツールでは、リセット・エラー時にタイマーを必ず止めるかをチェック項目に加える" },
  { title: "季節テーマ時の減点基準の見直し", how: "依頼テーマ自体が季節限定の場合、季節もの減点の対象外とするか、育てる期間の前提を短くする。" },
  { title: "季節ものツールの評価基準の調整", how: "spread狙いの場合、季節ものであっても「毎年恒例の定番として再浮上するポテンシャルがあるか」を考慮して評価できるようにする。" },
  { title: "差分修正でもチェックには全文を渡す", how: "修正後のチェックには、変更した箇所だけでなく、修正を反映したtool.html全体を必ず渡すようにする" },
];

test("提案箱: 同じ趣旨の提案は似ていると見分け、違う提案は見分けない", () => {
  for (let i = 0; i < same.length; i++) for (let j = i + 1; j < same.length; j++) assert.ok(similarity(same[i], same[j]) >= SIMILAR, `${same[i].title} / ${same[j].title}`);
  for (const a of [...same.slice(0, 1), ...others]) for (const b of others) if (a !== b) assert.ok(similarity(a, b) < SIMILAR, `${a.title} / ${b.title}`);
});

test("提案箱: 同じ趣旨の提案は入れずに回数を数え、見送ったものと同じ趣旨なら入れない。運営者の提案は止めない", () => {
  db().exec("DELETE FROM plan_requests");
  const first = addProposal({ ...same[0], target: "system", source: "scene", scene: "LPのチェック" });
  assert.ok(first);
  assert.equal(addProposal({ ...same[1], target: "system", source: "scene", scene: "LPのチェック" }), null);
  assert.equal(addProposal({ ...same[2], target: "system", source: "meeting" }), null);
  assert.equal((db().prepare("SELECT repeats FROM plan_requests WHERE id = ?").get(first) as { repeats: number }).repeats, 2);
  // 運営者にやってほしいこと（target が違う）は別に数える
  assert.ok(addProposal({ ...same[3], target: "human", source: "plan" }));
  // 見送ったものと同じ趣旨なら入れない
  const s = addProposal({ ...others[0], target: "system", source: "scene" });
  db().prepare("UPDATE plan_requests SET status = 'declined' WHERE id = ?").run(s);
  assert.equal(addProposal({ title: "再生の停止処理の確認", how: others[0].how, target: "system", source: "meeting" }), null);
  // 運営者が入れた提案は、似ていても入れる
  assert.ok(addProposal({ ...same[1], title: "表示順の確かめ（運営者）", target: "system", source: "human" }));
});

test("提案箱: すでに入っている同じ趣旨の提案は、1件にまとめる（頼んだもの → 声から入れたもの → 点の高いものを残す）", () => {
  db().exec("DELETE FROM plan_requests");
  const ins = (p: { title: string; how: string }, score: number | null) => Number(db().prepare("INSERT INTO plan_requests (title, how, source, target, score) VALUES (?, ?, 'scene', 'system', ?)").run(p.title, p.how, score).lastInsertRowid);
  // 点の高いものだけのときは、点の高いものを残す
  const a = ins(same[0], null), b = ins(same[1], 7), c = ins(same[2], null), x = ins(others[0], null);
  assert.equal(mergeSimilarOpen(true), 2);
  let left = (db().prepare("SELECT id, repeats FROM plan_requests ORDER BY id").all() as { id: number; repeats: number }[]);
  assert.deepEqual(left.map((r) => r.id), [b, x]);
  assert.equal(left[0].repeats, 2);
  assert.ok(!left.some((r) => r.id === a || r.id === c));
  // 2回目は何もしない（1時間に1回）
  assert.equal(mergeSimilarOpen(), 0);
  // 声から入れたものは、点が低くても残すほうにする（消さないので、ほかを残すと両方が残り続けた。PR #126 の ai-review の指摘）
  db().exec("DELETE FROM plan_requests");
  const hi = ins(same[0], 8), voiced = ins(same[1], null), lo = ins(same[2], null);
  db().prepare("INSERT INTO voices (scene, text, request_id) VALUES ('t', '声から入れた', ?)").run(voiced);
  assert.equal(mergeSimilarOpen(true), 2);
  left = (db().prepare("SELECT id, repeats FROM plan_requests ORDER BY id").all() as { id: number; repeats: number }[]);
  assert.deepEqual(left, [{ id: voiced, repeats: 2 }]);
  assert.ok(hi && lo);
  // 頼んだものがあれば、頼んだものを残し、声から入れたものも消さない
  db().exec("DELETE FROM plan_requests");
  const v2 = ins(same[0], null), a2 = ins(same[1], 3), o2 = ins(same[2], 9);
  db().prepare("INSERT INTO voices (scene, text, request_id) VALUES ('t', '声から入れた', ?)").run(v2);
  db().prepare("UPDATE plan_requests SET ai_fix_at = datetime('now') WHERE id = ?").run(a2);
  assert.equal(mergeSimilarOpen(true), 1);
  assert.equal((db().prepare("SELECT repeats FROM plan_requests WHERE id = ?").get(a2) as { repeats: number }).repeats, 1);
  assert.deepEqual((db().prepare("SELECT id FROM plan_requests ORDER BY id").all() as { id: number }[]).map((r) => r.id), [v2, a2]);
  assert.ok(o2);
});

test("提案箱: まとめるとき、残す提案と直接似ていない提案は消さない", async () => {
  const { similarity: sim } = await import("../src/lib/voices");
  db().exec("DELETE FROM plan_requests");
  // A は B とも C とも似ているが、B と C は似ていない。点の高い B を残すとき、C は消さない
  const A = { title: "表示順と中身の突き合わせとタイマーの停止", how: "design.order の中身を確かめ、setInterval のタイマーを止める" };
  const B = { title: "表示順と中身の突き合わせ", how: "design.order の中身を確かめる" };
  const C = { title: "タイマーの停止", how: "setInterval のタイマーを止める" };
  assert.ok(sim(A, B) >= 0.2 && sim(A, C) >= 0.2 && sim(B, C) < 0.2, `${sim(A, B)} ${sim(A, C)} ${sim(B, C)}`);
  const ins = (p: { title: string; how: string }, score: number | null) => Number(db().prepare("INSERT INTO plan_requests (title, how, source, target, score) VALUES (?, ?, 'scene', 'system', ?)").run(p.title, p.how, score).lastInsertRowid);
  const a = ins(A, null), b = ins(B, 8), c = ins(C, null);
  mergeSimilarOpen(true);
  const left = (db().prepare("SELECT id FROM plan_requests ORDER BY id").all() as { id: number }[]).map((r) => r.id);
  assert.ok(!left.includes(a), "A は B にまとめる");
  assert.ok(left.includes(b) && left.includes(c), "C は B と似ていないので残す");
});

test("定例会議の材料: 仕組みの改善の偏りと、運営者が手でやったことを渡す", () => {
  db().exec("DELETE FROM plan_requests");
  db().prepare("INSERT INTO plan_requests (title, how, source, target, scene, proposer) VALUES ('a', 'x', 'scene', 'system', 'LPのチェック', 'claude-opus-5-5')").run();
  db().prepare("INSERT INTO events (actor, kind, message) VALUES ('human', 'deep-upload', 'じっくり案件のツールを入れた')").run();
  const m = meetingMaterial("2000-01-01");
  assert.match(m, /返事待ちの仕組みの改善 1件: 出た場面 LPのチェック 1件/);
  assert.match(m, /deep-upload 1回（例: じっくり案件のツールを入れた）/);
});

test("提案箱: 返事がないまま30日たった提案は見送りにし、同じ提案がまた出たら入れる。何度も出たもの・頼んだもの・運営者の提案は残す", async () => {
  const { STALE_NOTE, expireStaleProposals } = await import("../src/lib/voices");
  const { aiImprovements } = await import("../src/lib/interventions");
  db().exec("DELETE FROM plan_requests");
  // 31日前に入った提案
  const ins = (p: { title: string; how: string }, o: { source?: string; repeats?: number; asked?: boolean } = {}) =>
    db().prepare(`INSERT INTO plan_requests (title, how, source, target, repeats, ai_fix_at, created_at) VALUES (?, ?, ?, 'system', ?, ?, datetime('now', '-31 days'))`)
      .run(p.title, p.how, o.source ?? "scene", o.repeats ?? 0, o.asked ? "2026-10-20 00:00:00" : null);
  ins(others[0]);
  ins(others[1], { repeats: 2 });
  ins(others[2], { asked: true });
  ins(others[3], { source: "human" });
  db().prepare("INSERT INTO plan_requests (title, how, source, target) VALUES ('新しい', 'まだ30日たっていない提案', 'scene', 'system')").run();
  assert.equal(expireStaleProposals(true), 1);
  const st = (t: string) => (db().prepare("SELECT status, note FROM plan_requests WHERE title = ?").get(t) as { status: string; note: string | null });
  assert.deepEqual(st(others[0].title), { status: "declined", note: STALE_NOTE });
  for (const t of [others[1].title, others[2].title, others[3].title, "新しい"]) assert.equal(st(t).status, "open", t);
  // 返事がないまま見送ったものは、改善の記録（人が判断したもの）に載せない
  assert.ok(!aiImprovements().some((r) => r.title === others[0].title));
  // 同じ提案がまた出てきたら入れる（題が同じでも、同じ趣旨でも）
  assert.ok(addProposal({ ...others[0], target: "system", source: "scene" }));
});

test("定例会議の材料: 返事がないまま見送ったものは、もう一度出してよいと伝え、運営者のひとことにしない", async () => {
  const { STALE_NOTE } = await import("../src/lib/voices");
  db().exec("DELETE FROM plan_requests");
  db().prepare("INSERT INTO plan_requests (title, source, target, status, note) VALUES ('古い提案', 'scene', 'system', 'declined', ?)").run(STALE_NOTE);
  const m = meetingMaterial("2000-01-01");
  assert.match(m, /「古い提案」（仕組み向け）→ 返事がないまま見送り（今も効くなら、もう一度出してよい）/);
  assert.doesNotMatch(m, /運営者のひとこと: 30日/);
});

test("定例会議: 採点者が答えた「同じ提案」の組は、両方を見た採点者の半分以上が答えたときだけまとめる", async () => {
  const { sameGroups } = await import("../src/lib/weekly");
  // 案 0〜5 の作者。採点者は自分の案を見ない
  const author = ["A", "B", "C", "A", "B", "box"];
  const saw = (who: string, i: number, j: number) => author[i] !== who && author[j] !== who;
  // 0(A) と 1(B) を見たのは C だけ → C が答えればまとめる
  assert.deepEqual(sameGroups(6, saw, [{ who: "C", pairs: [[0, 1]] }, { who: "A", pairs: [] }, { who: "B", pairs: [] }]), [[0, 1]]);
  // 2(C) と 5(提案箱) を見たのは A と B → 1人でも半分以上なのでまとめる。つながった組は1つにする
  assert.deepEqual(sameGroups(6, saw, [{ who: "A", pairs: [[2, 5]] }, { who: "B", pairs: [[5, 4]] }, { who: "C", pairs: [[4, 5]] }]), [[2, 4, 5]]);
  // 5(提案箱) と 3(A) を見たのは B と C。3人のうち見ていない A の答え（自分の案を含む）は数えない
  assert.deepEqual(sameGroups(6, saw, [{ who: "A", pairs: [[3, 5]] }, { who: "B", pairs: [] }, { who: "C", pairs: [] }]), []);
  // 番号の外・同じ番号は無視する
  assert.deepEqual(sameGroups(6, saw, [{ who: "C", pairs: [[0, 9], [1, 1], [-1, 0]] }]), []);
});
