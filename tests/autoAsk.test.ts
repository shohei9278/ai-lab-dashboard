import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import { db, getSettings, saveSettings } from "../src/lib/db";
import { addReviewFindings, GROWTH_SCENE, REVIEW_SCENE } from "../src/lib/codeReview";
import { maybeAutoAsk, nextAutoAsk } from "../src/lib/autoAsk";
import { scoringExisting } from "../src/lib/weekly";

// コードの見直しの攻めの提案と、見直しの提案の自動の依頼（運営者が決めた。人の出番を減らす4つ目）

const FIRE = "https://api.anthropic.com/v1/claude_code/routines/trig_01ABCDEF/fire";
const clear = () => db().prepare("DELETE FROM plan_requests").run();
const old = (id: number) => db().prepare("UPDATE plan_requests SET created_at = datetime('now', '-2 days') WHERE id = ?").run(id);
// 似た提案はまとめて入れない仕組みがあるので、題ごとに中身をはっきり変える
const TEXT: Record<string, [string, string]> = {
  届く先を増やす: ["lp-site の一覧に、ジャンルごとのまとめページを足して検索から来られるようにする", "訪問の9割がSNSからで、検索からの入口がない"],
  シェアの導線を足す: ["ツールの結果の画面に、結果の画像つきで X に送れるボタンを足す", "結果を出した人のシェアが0件のまま"],
  通知を足す: ["週のまとめを Discord に送る", "運営者が週の動きを見落とす"],
  x: ["何かを変える", "何かを読んだ"],
  守りの直し: ["src/lib/publish.ts の取り込みの失敗を記録する", "catch で捨てている"],
  攻めの機能: ["公開サイトに、新着のツールを知らせる RSS を足す", "再訪の入口がない"],
  守りA: ["src/lib/funnel.ts の集計を日本時間にそろえる", "UTC で切っている"],
  攻めA: ["遊んだ結果を友だちと比べるランキングを足す", "また来る理由が弱い"],
  守りB: ["src/lib/weekly.ts のテストを足す", "採点の並びにテストがない"],
  守りC: ["src/lib/sns.ts の投稿の失敗を Discord に知らせる", "投稿の失敗に気づけない"],
};
const fix = (t: string) => ({ title: t, how: TEXT[t][0], why: TEXT[t][1] });
const grow = (t: string) => ({ ...fix(t), kind: "growth" });

test("攻めの提案: kind=growth は「攻め」として入り、6日に2件まで。知らない kind は入れない", () => {
  clear();
  const r = addReviewFindings([grow("届く先を増やす"), grow("シェアの導線を足す"), grow("通知を足す"), { ...fix("x"), kind: "other" }]);
  assert.equal(r.added.length, 2);
  assert.match(r.skipped.join("\n"), /攻めの2件を超えた/);
  assert.match(r.skipped.join("\n"), /kind は fix/);
  const scenes = (db().prepare("SELECT scene FROM plan_requests ORDER BY id").all() as { scene: string }[]).map((x) => x.scene);
  assert.deepEqual(scenes, [GROWTH_SCENE, GROWTH_SCENE]);
});

test("攻めの提案: 定例会議で3社が採点する（守りは採点しない）", () => {
  clear();
  const [f] = addReviewFindings([fix("守りの直し")]).added;
  const [g] = addReviewFindings([grow("攻めの機能")]).added;
  const ids = scoringExisting().map((r) => r.id);
  assert.ok(ids.includes(g));
  assert.ok(!ids.includes(f));
});

test("自動の依頼: 守りは1日たってから、攻めは7点以上だけ。一度に1件で、進んでいる間は次を頼まない", () => {
  clear();
  const [f] = addReviewFindings([fix("守りA")]).added;
  const [g] = addReviewFindings([grow("攻めA")]).added;
  // 入ったばかりは頼まない（運営者が見送れるように）
  assert.equal(nextAutoAsk(), null);
  old(f);
  old(g);
  assert.equal(nextAutoAsk()?.row.id, f);
  // 守りを頼んで PR が開いている間は、攻めも頼まない
  db().prepare("UPDATE plan_requests SET ai_fix_at = datetime('now'), ai_fix_note = '自動: x', ai_fix_pr = 1, ai_fix_pr_state = 'open' WHERE id = ?").run(f);
  assert.equal(nextAutoAsk(), null);
  // PR がマージされて「やった」になったら、次は攻め。ただし7点未満は頼まない
  db().prepare("UPDATE plan_requests SET ai_fix_pr_state = 'merged', status = 'done' WHERE id = ?").run(f);
  db().prepare("UPDATE plan_requests SET score = 6.5 WHERE id = ?").run(g);
  assert.equal(nextAutoAsk(), null);
  db().prepare("UPDATE plan_requests SET score = 7.4 WHERE id = ?").run(g);
  assert.deepEqual([nextAutoAsk()?.row.id, nextAutoAsk()?.why], [g, "自動: コードの見直しの攻めの提案で、定例会議で3社の平均7.4点"]);
  // 守りは1日に1件まで
  const [f2] = addReviewFindings([fix("守りB")]).added;
  old(f2);
  assert.equal(nextAutoAsk()?.row.id, g);
  assert.ok(REVIEW_SCENE);
});

test("自動の依頼: 設定でオフ・緊急停止・ルーティンがつながっていないときは頼まない。頼んだら記録する", async () => {
  clear();
  const [f] = addReviewFindings([fix("守りC")]).added;
  old(f);
  process.env.CLAUDE_ROUTINE_FIRE_URL = FIRE;
  process.env.CLAUDE_ROUTINE_TOKEN = "t";
  const calls: string[] = [];
  const ok = async (_url: string, init: RequestInit) => {
    calls.push(String(init.body));
    return new Response(JSON.stringify({ claude_code_session_url: "https://claude.ai/code/session_x" }), { status: 200 });
  };
  const keep = getSettings();
  saveSettings({ autoAskReview: false });
  assert.equal(await maybeAutoAsk(ok, true), false);
  saveSettings({ autoAskReview: true, killSwitch: true });
  assert.equal(await maybeAutoAsk(ok, true), false);
  saveSettings({ killSwitch: false });
  assert.equal(await maybeAutoAsk(ok, true), true);
  assert.equal(calls.length, 1);
  const r = db().prepare("SELECT ai_fix_note, ai_fix_url FROM plan_requests WHERE id = ?").get(f) as { ai_fix_note: string; ai_fix_url: string };
  assert.match(r.ai_fix_note, /^自動: /);
  assert.equal(r.ai_fix_url, "https://claude.ai/code/session_x");
  assert.equal((db().prepare("SELECT COUNT(*) AS n FROM events WHERE kind = 'auto-ask'").get() as { n: number }).n, 1);
  saveSettings({ autoAskReview: keep.autoAskReview, killSwitch: keep.killSwitch });
  delete process.env.CLAUDE_ROUTINE_TOKEN;
});
