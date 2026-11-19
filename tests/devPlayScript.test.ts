import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import { db } from "../src/lib/db";
import { devRequestText, prepareLp, startDevUpload } from "../src/lib/loop";
import { PLAY_STEPS_MAX, givenPlayScript, parseGivenPlay, savePlayScript, type GivenPlay } from "../src/lib/playVideo";
import { takePlayScript } from "../lp-site/src/lp/htmlDom";

// 運営者の依頼（#66 の動画）: Claude Code で作るツールは、作った人が確かめた台本をツールと一緒に入れ、本番の動画はその手順で録画する
const tag = (v: unknown, type = "application/json") => `<script type="${type}" id="lab-play">${JSON.stringify(v)}</script>`;
const steps = [{ do: "drag", target: "#pad", from: [0.05, 0.5], dx: 0.9 }, { do: "click", target: "とじる" }, { do: "wait", ms: 5000, fast: 8 }, { do: "click", target: "焼きへ" }];

test("動画の台本（lab-play）: ツールの HTML から取り出し、公開するツールからは除く（ほかの部分は変えない）", () => {
  const tool = `<div id="g">遊ぶ</div>\n<script>var a = "<b>";</script>`;
  const r = takePlayScript(`${tool}\n${tag({ steps })}`);
  // 切り取るのは台本の要素だけ（前後の空白も残す。PR #107 の ai-review の指摘）
  assert.equal(r.html, `${tool}\n`);
  assert.deepEqual(JSON.parse(r.json!), { steps });
  // 台本がなければ、そのまま
  assert.deepEqual(takePlayScript(tool), { html: tool, json: null });
  // 2つ以上・JSON でない type は断る（どれが本物か分からない・スクリプトとして動いてしまう）
  assert.match(takePlayScript(tool + tag({ steps }) + tag({ steps })).error!, /2つ以上/);
  assert.match(takePlayScript(tool + tag({ steps }, "text/javascript")).error!, /application\/json/);
  // script の文字の中の「id="lab-play"」は台本ではない
  assert.equal(takePlayScript(`<script>var s = '<script type="application/json" id="lab-play">{}</' + 'script>';</script>`).json, null);
});

test("動画の台本（lab-play）: 書いた手順がそのまま使えるときだけ受け付ける", () => {
  assert.deepEqual(parseGivenPlay({ hook: "なぞってひだ", steps }), { hook: "なぞってひだ", steps: [{ do: "drag", target: "#pad", from: [0.05, 0.5], dx: 0.9, dy: 0 }, ...steps.slice(1)] });
  // 書かなかった値（dy など）は既定の値でよい。一言はなくてもよい
  assert.equal(typeof parseGivenPlay({ steps }), "object");
  // 範囲の外の値・使えない倍速は、変えずに断る（作った人が確かめた手順と、録画する手順を同じにするため）
  assert.match(parseGivenPlay({ steps: [...steps.slice(0, 2), { do: "wait", ms: 99_999 }] }) as string, /範囲の外/);
  assert.match(parseGivenPlay({ steps: [...steps.slice(0, 2), { do: "wait", ms: 5000, fast: 1.5 }] }) as string, /範囲の外/);
  assert.match(parseGivenPlay({ steps: [{ do: "click", target: "a" }, { do: "jump" }] }) as string, /2個の手順のうち、1個しか使えません/);
  assert.match(parseGivenPlay({ steps: [...Array.from({ length: PLAY_STEPS_MAX + 1 }, () => ({ do: "wait", ms: 300 })), { do: "click", target: "a" }] }) as string, /押す・なぞる手順|手順は/);
  assert.match(parseGivenPlay({ steps: [{ do: "wait", ms: 500 }] }) as string, /押す・なぞる手順が1つもない/);
  assert.match(parseGivenPlay({ hook: "x" }) as string, /steps/);
  // 一言も、書いた値をそのまま使えるときだけ（文字でない・前後に空白がある・長すぎる一言は断る。PR #107 の ai-review の指摘）
  for (const hook of [3, " なぞってひだ ", "", "あ".repeat(25)]) assert.match(parseGivenPlay({ hook, steps }) as string, /hook/, JSON.stringify(hook));
  assert.equal(typeof parseGivenPlay({ hook: "あ".repeat(24), steps }), "object");
});

test("動画の台本（lab-play）: 入れたツールの HTML と結び付けて残し、同じ HTML のときだけ使う", () => {
  const id = Number(db().prepare("INSERT INTO projects (title, target, problem, solution, hypothesis, ai_reason, stage, model_id, kind) VALUES ('t','t','p','s','h','r','live','claude','tool')").run().lastInsertRowid);
  const given = parseGivenPlay({ steps }) as Exclude<ReturnType<typeof parseGivenPlay>, string>;
  savePlayScript(id, "<p>v1</p>", given);
  assert.deepEqual(givenPlayScript(id, "<p>v1</p>"), given);
  assert.equal(givenPlayScript(id, "<p>v2</p>"), null);
  // 入れ直すと、その HTML の台本が新しくなる
  savePlayScript(id, "<p>v1</p>", { ...given, hook: "新しい一言" });
  assert.equal(givenPlayScript(id, "<p>v1</p>")!.hook, "新しい一言");
});

const addDeep = () => Number(db().prepare(
  "INSERT INTO projects (title, target, problem, solution, hypothesis, ai_reason, stage, model_id, kind, deep, deep_plan, aim) VALUES ('ひだ', '学生', '見せたい', 'なぞる遊び', 'h', 'r', 'idea', 'claude', 'tool', 1, '手ざわり', 'spread')",
).run().lastInsertRowid);
const pendingDev = (id: number) => db().prepare("SELECT * FROM approvals WHERE project_id = ? AND kind = 'dev' AND status = 'pending'").get(id) as { id: number; payload: string } | undefined;
const seedDesign = (id: number) => db().prepare("INSERT INTO approvals (project_id, kind, proposal, reason, status, payload) VALUES (?, 'dev', '前', '前', 'revised', ?)").run(id, JSON.stringify({ design: "## 一言で\nなぞる遊び", instruction: null }));

test("動画の台本（lab-play）: Claude Code への依頼文に書き方を入れ、ツールを入れるときに台本を取り出して残す。使えない台本は理由を返して入れない", async () => {
  const id = addDeep();
  seedDesign(id);
  await prepareLp(id);
  const a = pendingDev(id)!;
  const text = devRequestText(id, (JSON.parse(a.payload) as { design: string }).design, null);
  assert.match(text, /## 遊ぶ様子の動画の台本/);
  assert.match(text, /id="lab-play"/);
  assert.match(text, /scripts\/play-check\.mts/);
  assert.match(text, /- drag: /);
  const tool = `<button id="b">とじる</button><div id="pad"></div><script>document.getElementById('b').onclick=()=>{}</script>`;
  // 使えない台本は、理由を返して入れない（開発待ちのまま）
  assert.throws(() => startDevUpload(a.id, tool + tag({ steps: [{ do: "wait", ms: 500 }] })), /動画の台本（lab-play）が使えません: 押す・なぞる手順が1つもない/);
  assert.throws(() => startDevUpload(a.id, tool + `<script type="application/json" id="lab-play">{</script>`), /JSON として読めません/);
  assert.ok(pendingDev(id));
  // 使える台本は、台本を除いたツールの HTML と結び付けて残す（このあとの紹介ページづくりはAIを呼ぶので、テストでは失敗で終わる）
  const job = startDevUpload(a.id, `${tool}\n${tag({ hook: "なぞってひだ", steps })}`);
  assert.equal(givenPlayScript(id, tool)!.hook, "なぞってひだ");
  assert.match((db().prepare("SELECT message FROM events WHERE project_id = ? AND kind = 'dev-upload'").get(id) as { message: string }).message, /遊ぶ様子の動画の台本（手順4つ）も入れました/);
  await assert.rejects(job);
  // 取り込みが失敗したら（ここではAIのキーがない）、前の台本に戻す（前はなかったので、なし。PR #107 の ai-review の指摘）
  assert.equal(givenPlayScript(id, tool), null);
  // 前の台本がある HTML を、台本なしで入れ直したら消す。取り込みが失敗したら、前の台本に戻す
  savePlayScript(id, tool, { ...(parseGivenPlay({ steps }) as GivenPlay), hook: "前の一言" });
  const b = pendingDev(id)!;
  const job2 = startDevUpload(b.id, tool);
  assert.equal(givenPlayScript(id, tool), null);
  await assert.rejects(job2);
  assert.equal(givenPlayScript(id, tool)!.hook, "前の一言");
});
