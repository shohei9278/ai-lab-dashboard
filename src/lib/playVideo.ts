import fs from "node:fs";
import path from "node:path";
import type { Frame } from "playwright-core";
import { callClaude, callJson, claudeModelId, isObj, isStr } from "./ai";
import { dataDir, db, getSettings, type ProjectRow } from "./db";
import { launch } from "./freePage";
import { external } from "./untrusted";
import { getProject, logEvent } from "./loop";
import { versionLp } from "./versions";
import { recordToMp4 } from "./videoRender";
import { wrapToolHtml } from "../../lp-site/src/lp/toolHtml";

// 動くツールを遊ぶ様子の、縦長の短い動画（SNSに投稿するため）
// AIが遊び方の台本（押すボタン・入れる値）を書き、本物のブラウザでツールを動かして録画する。録画のコマをAIが見て、伝わるかを確かめる
// 投稿は、今は人が手で行う（動画を保存して、投稿文の案と一緒に投稿する）

export type PlayStep = { do: "click" | "fill" | "wait"; target?: string; value?: string; ms?: number };
export type PlayScript = { hook: string; steps: PlayStep[]; caption: string };
export type PlayCheck = { ok: boolean; issues: string[]; skipped?: string };
export type PlayVideoRow = { id: number; at: string; project_id: number; version: number; file: string; hook: string; caption: string; script: string; check_json: string | null; ok: number };

export const PLAY_STEPS_MAX = 10;
// 動画の長さの上限（秒）。これを超える分の手順は切る
export const PLAY_SECONDS_MAX = 15;

// 手順1つにかかる時間（秒）の見積もり。押す・入れる: 指を動かす（約0.6秒）＋操作＋あとの待ち（0.7秒）。入れる文字は1文字0.07秒
const stepSeconds = (s: PlayStep) => (s.do === "wait" ? (s.ms ?? 800) / 1000 : s.do === "fill" ? 1.5 + 0.07 * (s.value ?? "").length : 1.6);
// 動画全体の長さの見積もり（最初の0.7秒と、結果を読ませる最後の2.2秒を含む）
export const playSeconds = (steps: PlayStep[]) => 0.7 + steps.reduce((t, s) => t + stepSeconds(s), 0) + 2.2;

// AIの台本を、決めた形にそろえる（読めない・押す所がないものは null）。長さが上限を超える分の手順は切る
export function parsePlayScript(v: unknown): PlayScript | null {
  if (!isObj(v) || !Array.isArray(v.steps)) return null;
  const steps: PlayStep[] = [];
  for (const s of v.steps.slice(0, PLAY_STEPS_MAX)) {
    if (!isObj(s)) continue;
    let step: PlayStep | null = null;
    if (s.do === "wait") step = { do: "wait", ms: Math.max(300, Math.min(3000, Number(s.ms) || 800)) };
    else if ((s.do === "click" || s.do === "fill") && isStr(s.target) && s.target.trim()) {
      step = { do: s.do, target: s.target.trim().slice(0, 80), ...(s.do === "fill" ? { value: String(s.value ?? "").slice(0, 60) } : {}) };
    }
    if (!step) continue;
    if (playSeconds([...steps, step]) > PLAY_SECONDS_MAX) break;
    steps.push(step);
  }
  if (!steps.some((s) => s.do === "click")) return null;
  // 動画の上の一言と投稿文の案は必ず要る（欠けた台本は使わず、AIに書き直させる）
  if (!isStr(v.hook) || !v.hook.trim() || !isStr(v.caption) || !v.caption.trim()) return null;
  return { hook: v.hook.trim().slice(0, 24), steps, caption: v.caption.trim().slice(0, 200) };
}

// コマの確かめの答えを読む。読めない・形が違う答えは「確かめられなかった」として問題に残す（問題なしにはしない）
export function parsePlayCheck(text: string): PlayCheck {
  const t = text.replace(/```(?:json)?/g, "");
  try {
    const v = JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1)) as unknown;
    // 一覧の中身がすべて文字のときだけ読む（null や数が混ざったら、形が違う答えとして扱う）
    if (isObj(v) && Array.isArray(v.issues) && v.issues.every((x) => typeof x === "string")) {
      const issues = v.issues.filter(isStr).slice(0, 5).map((x) => x.slice(0, 200));
      return { ok: issues.length === 0, issues };
    }
  } catch {}
  return { ok: false, issues: ["コマの確かめの答えを読めなかった（伝わるかを確かめられていない）"] };
}

export const playVideoPath = (file: string): string | null => (/^play-\d+-\d+\.mp4$/.test(file) ? path.join(dataDir("videos"), file) : null);
export const listPlayVideos = (projectId: number) => db().prepare("SELECT * FROM play_videos WHERE project_id = ? ORDER BY id DESC LIMIT 5").all(projectId) as PlayVideoRow[];

async function writePlayScript(p: ProjectRow, html: string, issues: string[] = []): Promise<PlayScript> {
  return callJson<PlayScript>({
    purpose: "遊ぶ様子の動画の台本",
    projectId: p.id,
    system: `あなたは短い縦長の動画（Xのタイムラインで流れる、10〜15秒ほど）の台本を書く担当です。動くツールを実際に遊ぶ様子を録画して、見た人が1秒で何をするものか分かり、遊んでみたくなる動画にします。
ツールのHTMLを読み、押すボタン・入れる値の順番（steps）を書きます。
- click: target に、押すボタンなどに見えている文字（そのまま）を書く。文字で見分けられないときだけ、HTMLにある CSS のセレクタ（#id や .class）を書く
- fill: target に入力欄のセレクタ（#id など）か、入力欄のラベルの文字を書き、value に入れる値を書く（自然な例。実在の人の名前・連絡先は使わない）
- wait: ms に待つ時間（300〜3000）。結果が出るまでに演出があるツールは、結果が見えるまで待つ
- 最初の3秒のうちに、いちばん面白い瞬間（結果・オチ）へ向かうように、前置きの操作は最小にする。steps は${PLAY_STEPS_MAX}個まで。最後は結果が画面に出ている状態で終える
- hook: 動画の上に大きく出す一言（20文字以内）。何をするものか・何が起きるかが一言で分かるもの。誇大な表現・実在の人物や作品の名前は使わない
- caption: 投稿の本文の案（120文字以内。リンクは付けない（あとで付ける）。ハッシュタグは1〜2個まで）
出力はJSONのみ: {"hook":"","steps":[{"do":"click","target":"回す"},{"do":"wait","ms":1500}],"caption":""}`,
    user: `ツール名: ${p.title}\n何ができるか: ${p.solution}\n\nツールのHTML:\n${external(html.slice(0, 30_000))}${issues.length ? `\n\n前の台本で録画したら、次の問題があった。直した台本を書く:\n${issues.map((x) => `- ${x}`).join("\n")}` : ""}`,
    validate: (v): v is PlayScript => parsePlayScript(v) !== null,
  }).then((v) => parsePlayScript(v)!);
}

const TOP = 300;
const BOTTOM = 120;
// ツールの枠を 360px 幅で開き（ツールから見た画面の幅もスマホと同じ。幅で並びを変えるツールもスマホの並びになる）、枠ごと3倍にして映す
const SCALE = 3;
const PHONE_W = 1080 / SCALE;

// 見えている文字・セレクタから、押す所・入れる所を探す
async function find(frame: Frame, step: PlayStep) {
  const t = step.target!;
  const tries = step.do === "fill"
    ? [() => frame.getByLabel(t, { exact: false }), () => frame.getByPlaceholder(t, { exact: false }), () => frame.locator(t)]
    : [() => frame.getByRole("button", { name: t, exact: false }), () => frame.getByText(t, { exact: false }), () => frame.locator(t)];
  // 同じ文字の候補が複数あるとき（PC用とスマホ用など）は、見えている最初のものを使う
  for (const make of tries) {
    try {
      const all = make();
      const n = Math.min(await all.count(), 10);
      for (let i = 0; i < n; i++) {
        const l = all.nth(i);
        if (await l.isVisible()) return l;
      }
    } catch {}
  }
  return null;
}

// 台本どおりに遊ぶ様子を録画する。押す前に、指の印をその場所へ動かす（何を押したか分かるように）
// 返す shots は、最初・途中・最後の画面（AIの確かめに使う。録画には入らない）
export async function renderPlay(script: PlayScript, toolHtml: string, opts: { data?: unknown[]; fonts?: boolean; illustration?: string }, title: string, out: string): Promise<{ done: number; failed: string[]; shots: Buffer[] }> {
  const browser = await launch();
  if (typeof browser === "string") throw new Error(browser);
  try {
    const ctx = await browser.newContext({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1, locale: "ja-JP" });
    const page = await ctx.newPage();
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
    await page.setContent(`<!doctype html><meta charset="utf-8"><style>
*{margin:0;box-sizing:border-box}html,body{width:1080px;height:1920px;overflow:hidden;background:#fff;font-family:"Hiragino Sans","Noto Sans CJK JP",sans-serif}
#top{position:absolute;top:0;left:0;width:1080px;height:${TOP}px;display:flex;align-items:center;justify-content:center;text-align:center;padding:0 56px;background:#111;color:#fff;font-size:76px;font-weight:800;line-height:1.3}
#bottom{position:absolute;bottom:0;left:0;width:1080px;height:${BOTTOM}px;display:flex;align-items:center;justify-content:center;background:#111;color:#bbb;font-size:40px;font-weight:700}
iframe{position:absolute;top:${TOP}px;left:0;width:${PHONE_W}px;height:${(1920 - TOP - BOTTOM) / SCALE}px;border:0;background:#fff;transform:scale(${SCALE});transform-origin:0 0}
#finger{position:absolute;width:96px;height:96px;margin:-48px 0 0 -48px;border-radius:50%;background:rgba(255,80,80,.45);border:6px solid rgba(255,255,255,.9);box-shadow:0 4px 18px rgba(0,0,0,.35);opacity:0;transition:left .45s ease,top .45s ease,opacity .2s,transform .12s;z-index:5;pointer-events:none}
</style><div id="top">${esc(script.hook || title)}</div><iframe id="f"></iframe><div id="bottom">${esc(title)}｜登録なしで遊べる</div><div id="finger"></div>`);
    const frameEl = page.locator("#f");
    await frameEl.evaluate((el, html) => { (el as HTMLIFrameElement).srcdoc = html; }, wrapToolHtml(toolHtml, opts));
    await page.waitForTimeout(400);
    const frame = page.frames().find((f) => f.parentFrame());
    if (!frame) throw new Error("ツールの枠を開けませんでした");
    await frame.waitForLoadState("load").catch(() => undefined);
    await page.waitForTimeout(500);
    const shots: Buffer[] = [];
    const failed: string[] = [];
    let done = 0;
    const tap = async (box: { x: number; y: number; width: number; height: number }) => {
      await page.evaluate(({ x, y }) => { const f = document.getElementById("finger")!; f.style.opacity = "1"; f.style.left = `${x}px`; f.style.top = `${y}px`; }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
      await page.waitForTimeout(500);
      await page.evaluate(() => { document.getElementById("finger")!.style.transform = "scale(.8)"; });
      await page.waitForTimeout(120);
      await page.evaluate(() => { document.getElementById("finger")!.style.transform = "scale(1)"; });
    };
    shots.push(await page.screenshot({ type: "jpeg", quality: 70 }));
    // 途中のコマは、真ん中の手順のあとに、うまくいったかにかかわらず必ず撮る（コマは最初・途中・最後の3枚にそろえる）
    const mid = Math.floor((script.steps.length - 1) / 2);
    const midShot = async (hold: (fn: () => Promise<void>) => Promise<void>) => hold(async () => { shots.push(await page.screenshot({ type: "jpeg", quality: 70 })); });
    await recordToMp4(page, async (rawHold) => {
      // 録画に入った時間（撮らない間は除く）。15秒に収まらない手順は、やる前に打ち切る（台本の見積もりより操作が遅れても、上限を守る）
      const start = Date.now();
      let held = 0;
      const hold = async (fn: () => Promise<void>) => {
        const t = Date.now();
        await rawHold(fn);
        held += Date.now() - t;
      };
      const recorded = () => (Date.now() - start - held) / 1000;
      await page.waitForTimeout(700);
      for (const [i, step] of script.steps.entries()) {
        if (recorded() + stepSeconds(step) + 2.2 > PLAY_SECONDS_MAX) {
          failed.push(`${PLAY_SECONDS_MAX}秒に収めるため、${i + 1}番目から先の手順を切った`);
          break;
        }
        try {
          if (step.do === "wait") {
            await page.waitForTimeout(step.ms ?? 800);
            continue;
          }
          const l = await find(frame, step);
          if (!l) {
            failed.push(`${i + 1}番目の「${step.target}」が見つからなかった`);
            continue;
          }
          try {
            await l.scrollIntoViewIfNeeded({ timeout: 1500 });
            const box = await l.boundingBox();
            if (box) await tap(box);
            // 入れられない・押せない所（止められている・ほかの要素に覆われているなど）は、短い時間で諦めて次へ進む
            if (step.do === "fill") {
              await l.fill("", { timeout: 1500 });
              await l.pressSequentially(step.value ?? "", { delay: 70, timeout: 1500 + 100 * (step.value ?? "").length });
            } else await l.click({ timeout: 1500 });
            done++;
            await page.waitForTimeout(700);
          } catch (e) {
            failed.push(`${i + 1}番目の「${step.target}」を操作できなかった（${(e instanceof Error ? e.message : String(e)).split("\n")[0].slice(0, 80)}）`);
          }
        } finally {
          if (i === mid) await midShot(hold);
        }
      }
      // 途中で打ち切って真ん中まで届かなかったときも、途中のコマを撮る（コマは最初・途中・最後の3枚にそろえる）
      if (shots.length < 2) await midShot(hold);
      await page.evaluate(() => { document.getElementById("finger")!.style.opacity = "0"; });
      // 結果を読めるよう、最後に止める（残りの時間まで。動画は最後に15秒で切るので、結果を見せる場面が切れないよう短くする）
      await page.waitForTimeout(Math.max(300, Math.min(2200, (PLAY_SECONDS_MAX - recorded()) * 1000)));
      await hold(async () => { shots.push(await page.screenshot({ type: "jpeg", quality: 70 })); });
    }, out, () => browser.close(), { maxSeconds: PLAY_SECONDS_MAX });
    return { done, failed, shots };
  } finally {
    await browser.close().catch(() => undefined);
  }
}

// 録画のコマ（最初・途中・最後）をAIに見せて、伝わるかを確かめる（Claude のキーがなければ確かめを飛ばす）
async function checkPlay(p: ProjectRow, script: PlayScript, shots: Buffer[]): Promise<PlayCheck> {
  if (!claudeModelId()) return { ok: true, issues: [], skipped: "Claude のキーがないため、コマの確かめを飛ばしました" };
  const out = await callClaude({
    purpose: "遊ぶ様子の動画の確かめ",
    projectId: p.id,
    system: `あなたは短い縦長の動画（Xのタイムラインで流れる）の編集者です。動くツールを遊ぶ様子を録画した動画の、最初・途中・最後のコマを見て、次に当てはまる問題だけを挙げます（好みの問題は挙げない）。
- 最初のコマと上の一言で、何をするものかが分からない
- 最後のコマで、遊んだ結果（答え・オチ・できあがったもの）が見えていない（エラー・空の画面・押す前のまま）
- 文字が小さすぎて読めない・はみ出している・重なっている
問題がなければ issues は空。
出力はJSONのみ: {"issues":["問題と、台本をどう直すか"]}`,
    content: [
      { type: "text", text: `ツール名: ${p.title}\n上の一言: ${script.hook}\n台本: ${script.steps.map((s) => (s.do === "wait" ? `待つ${s.ms}ms` : `${s.do === "fill" ? "入力" : "押す"}「${s.target}」${s.value ? `に「${s.value}」` : ""}`)).join(" → ")}` },
      ...shots.flatMap((b, i) => [{ type: "text" as const, text: ["最初", "途中", "最後"][i] ?? `${i + 1}枚目` }, { type: "image" as const, source: { type: "base64" as const, media_type: "image/jpeg" as const, data: b.toString("base64") } }]),
    ],
    maxTokens: 2000,
  });
  return parsePlayCheck(out);
}

const g = globalThis as unknown as { __aiLabPlayQueue?: Promise<unknown>; __aiLabPlayPending?: Set<number> };
// 動画を作っている（順番待ちを含む）案件。同じ案件の動画を重ねて頼まれても受け付けない（同じ動画が何本もでき、そのぶん費用がかかるため）
const pending = (g.__aiLabPlayPending ??= new Set());
export const playVideoPending = (projectId: number) => pending.has(projectId);

// 動くツールの案件の、今の版を遊ぶ様子の動画を作る。台本 → 録画 → コマの確かめ。問題があれば台本を1回だけ直して撮り直す
// 同時に作るのは1本だけ（ブラウザと動画の変換でメモリを使うため）。作っている途中に頼まれたら、順番待ちにして、前のものが終わってから作る（断らない）
export function makePlayVideo(projectId: number): Promise<number> {
  if (pending.has(projectId)) throw new Error("この案件の遊ぶ様子の動画は、いま作っています（順番待ちを含む）。できあがるまでお待ちください");
  pending.add(projectId);
  const run = (g.__aiLabPlayQueue ?? Promise.resolve()).catch(() => undefined).then(() => makeOnce(projectId)).finally(() => pending.delete(projectId));
  g.__aiLabPlayQueue = run.catch(() => undefined);
  return run;
}

async function makeOnce(projectId: number): Promise<number> {
  const p = getProject(projectId);
  if (!p || p.kind !== "tool") throw new Error("動くツールの案件だけ、遊ぶ様子の動画を作れます");
  const lp = versionLp(p, p.lp_version);
  if (!lp?.tool) throw new Error("ツールがまだありません");
  // 途中で失敗したら、この回に作った動画のファイルを消す（どこからも参照されないファイルを残さない）
  const made: string[] = [];
  let saved = false;
  try {
    const tool = lp.tool;
    const opts = { data: tool.data, fonts: tool.fonts, illustration: lp.design?.illustration?.url };
    let script = await writePlayScript(p, tool.html);
    let file = "";
    let check: PlayCheck = { ok: false, issues: [] };
    for (let round = 0; round < 2; round++) {
      // 同じ案件・同じ時刻でも重ならないよう、時刻のうしろに乱数を足す
      file = `play-${p.id}-${Date.now()}${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}.mp4`;
      made.push(file);
      const r = await renderPlay(script, tool.html, opts, p.title, playVideoPath(file)!);
      const notes = [...r.failed, ...(r.done === 0 ? ["台本の操作が1つもできなかった（押す所の文字やセレクタが、HTMLと合っていない）"] : [])];
      check = r.done === 0 ? { ok: false, issues: notes } : await checkPlay(p, script, r.shots);
      if (r.done > 0 && notes.length) check = { ...check, ok: false, issues: [...notes, ...check.issues] };
      if (check.ok || round === 1) break;
      fs.rmSync(playVideoPath(file)!, { force: true });
      script = await writePlayScript(p, tool.html, check.issues);
    }
    const id = Number(db().prepare("INSERT INTO play_videos (project_id, version, file, hook, caption, script, check_json, ok) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(p.id, p.lp_version, file, script.hook, script.caption, JSON.stringify(script), JSON.stringify(check), check.ok ? 1 : 0).lastInsertRowid);
    saved = true;
    logEvent(p.id, "ai", "play-video", `遊ぶ様子の動画を作りました（第${p.lp_version}版。「${script.hook}」${check.ok ? "" : `。確かめで残った問題: ${check.issues.join(" / ").slice(0, 200)}`}）`);
    return id;
  } finally {
    if (!saved) for (const f of made) fs.rmSync(playVideoPath(f)!, { force: true });
  }
}

// 公開したときに、ねらいが「広がる」の案件は、裏で遊ぶ様子の動画を作っておく（投稿に使う。失敗しても公開は止めない）
export function makePlayVideoOnPublish(p: Pick<ProjectRow, "id" | "kind" | "aim">) {
  if (p.kind !== "tool" || p.aim !== "spread" || getSettings().killSwitch || pending.has(p.id)) return;
  void makePlayVideo(p.id).catch((e) => logEvent(p.id, "system", "play-video-error", `遊ぶ様子の動画を作れませんでした: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`));
}
