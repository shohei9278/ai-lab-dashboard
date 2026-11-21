import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Frame, Locator } from "playwright-core";
import { callClaude, callJson, claudeModelId, isObj, isStr } from "./ai";
import { dataDir, db, getSettings, type ProjectRow } from "./db";
import { launch } from "./freePage";
import { external } from "./untrusted";
import { getProject, logEvent } from "./loop";
import { versionLp } from "./versions";
import { recordToMp4 } from "./videoRender";
import { limitTags, tagHints, tagRule } from "./hashtags";
import { wrapToolHtml } from "../../lp-site/src/lp/toolHtml";
import type { ToolImages } from "../../lp-site/src/lp/content";

// 動くツールを遊ぶ様子の、縦長の短い動画（SNSに投稿するため）
// AIが遊び方の台本（押すボタン・入れる値）を書き、本物のブラウザでツールを動かして録画する。録画のコマをAIが見て、伝わるかを確かめる
// 投稿は、今は人が手で行う（動画を保存して、投稿文の案と一緒に投稿する）

// drag: 指やマウスで動かして遊ぶツール用。target の要素を押さえ（from: 要素の中の位置。横・縦の 0〜1、初めは真ん中）、
// 要素の幅・高さに対する割合（dx・dy。-1〜1、右・下が正）だけ動かして離す
// wait の fast: 早送りで待つ（2〜FAST_MAX 倍）。ツールの中では ms の時間が進み、動画では ms÷fast の長さで済む（焼ける・育つなど、待つ場面が長いゲーム用）
export type PlayStep = { do: "click" | "fill" | "wait" | "drag"; target?: string; value?: string; ms?: number; fast?: number; dx?: number; dy?: number; from?: [number, number] };
export type PlayScript = { hook: string; steps: PlayStep[]; caption: string };
export type PlayCheck = { ok: boolean; issues: string[]; skipped?: string };
export type PlayVideoRow = { id: number; at: string; project_id: number; version: number; file: string; hook: string; caption: string; script: string; check_json: string | null; ok: number };

export const PLAY_STEPS_MAX = 10;
// 動画の上の一言の長さの上限（AIが書く台本も、Claude Code が書く台本も同じ）
export const PLAY_HOOK_MAX = 24;
// 投稿文の案に付けてよいハッシュタグの数（X に載せる前提）
export const PLAY_TAG_MAX = 2;
// 動画の長さの上限（秒）。これを超える分の手順は切る
export const PLAY_SECONDS_MAX = 15;
// 早送りの速さの上限（倍）と、早送りで待つときにツールの中で進める時間の上限（ミリ秒）
export const FAST_MAX = 8;
export const FAST_WAIT_MAX = 15_000;

// 手順1つにかかる時間（秒）の見積もり。押す・入れる: 指を動かす（約0.4秒）＋操作＋あとの待ち（0.45秒）。入れる文字は1文字0.07秒
// ドラッグ: 指を動かす（約0.4秒）＋動かす（約0.9秒）＋あとの待ち（0.45秒）
// 指の動きとあとの待ちは、15秒の中で遊びの最後（結果）まで見せられるよう短めにしている（#66 の動画。前は 0.6秒・0.7秒）
export const DRAG_MS = 900;
const FINGER_MS = 350;
// 押す所が見つからないとき、出てくるのを待つ長さ
const FIND_WAIT_MS = 1200;
const STEP_PAUSE_MS = 450;
// 早送りの見積もりの余裕。早送りの間もツールは1コマずつ描き直すので、重いツールでは ms÷fast より長くかかる
// 速くするほど1秒あたりに描き直すコマが増えて遅れも増える（#66 で測ると、6倍で2〜3割、8倍で5割ほど長かった）
export const fastSlack = (fast: number) => 1 + 0.06 * fast;
// 早送りで待つ手順は、動画では ms÷fast（に余裕を足した）長さになる
const stepSeconds = (s: PlayStep) => (s.do === "wait" ? ((s.ms ?? 800) / (s.fast ?? 1) / 1000) * (s.fast ? fastSlack(s.fast) : 1) : s.do === "fill" ? 1.1 + 0.07 * (s.value ?? "").length : s.do === "drag" ? 1.9 : 1.2);
const clamp = (v: unknown, lo: number, hi: number, d: number) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
// 動画全体の長さの見積もり（最初の0.7秒と、結果を読ませる最後の2.2秒を含む）
export const playSeconds = (steps: PlayStep[]) => 0.7 + steps.reduce((t, s) => t + stepSeconds(s), 0) + 2.2;

// AIの台本を、決めた形にそろえる（読めない・押す所がないものは null）。長さが上限を超える分の手順は切る
export function parsePlayScript(v: unknown): PlayScript | null {
  if (!isObj(v) || !Array.isArray(v.steps)) return null;
  const steps: PlayStep[] = [];
  for (const s of v.steps.slice(0, PLAY_STEPS_MAX)) {
    if (!isObj(s)) continue;
    let step: PlayStep | null = null;
    if (s.do === "wait") {
      // 早送り（fast が 2〜FAST_MAX の整数）のときは、ツールの中で進める時間を FAST_WAIT_MAX まで認める。それ以外の fast は付けない
      const fast = Number.isInteger(s.fast) && (s.fast as number) >= 2 && (s.fast as number) <= FAST_MAX ? (s.fast as number) : undefined;
      step = fast
        ? { do: "wait", ms: Math.max(300, Math.min(FAST_WAIT_MAX, Number(s.ms) || 800)), fast }
        : { do: "wait", ms: Math.max(300, Math.min(3000, Number(s.ms) || 800)) };
    }
    else if ((s.do === "click" || s.do === "fill") && isStr(s.target) && s.target.trim()) {
      step = { do: s.do, target: s.target.trim().slice(0, 80), ...(s.do === "fill" ? { value: String(s.value ?? "").slice(0, 60) } : {}) };
    } else if (s.do === "drag" && isStr(s.target) && s.target.trim()) {
      const dx = clamp(s.dx, -1, 1, 0), dy = clamp(s.dy, -1, 1, 0);
      // 動かさないドラッグは、押すのと同じなので使わない（台本の誤り）
      if (Math.abs(dx) + Math.abs(dy) < 0.02) continue;
      const from = Array.isArray(s.from) && s.from.length === 2 ? [clamp(s.from[0], 0, 1, 0.5), clamp(s.from[1], 0, 1, 0.5)] as [number, number] : undefined;
      step = { do: "drag", target: s.target.trim().slice(0, 80), dx, dy, ...(from ? { from } : {}) };
    }
    if (!step) continue;
    if (playSeconds([...steps, step]) > PLAY_SECONDS_MAX) break;
    steps.push(step);
  }
  // 押すかドラッグする手順が1つもない台本は使わない（入れて待つだけでは、遊ぶ様子にならない）
  if (!steps.some((s) => s.do === "click" || s.do === "drag")) return null;
  // 動画の上の一言と投稿文の案は必ず要る（欠けた台本は使わず、AIに書き直させる）
  if (!isStr(v.hook) || !v.hook.trim() || !isStr(v.caption) || !v.caption.trim()) return null;
  return { hook: v.hook.trim().slice(0, PLAY_HOOK_MAX), steps, caption: limitTags(v.caption.trim(), PLAY_TAG_MAX).slice(0, 200) };
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

// 台本の手順の書き方（AIが台本を書くときと、Claude Code に貼る依頼文で同じものを使う）
export const PLAY_STEP_RULES = `- click: target に、押すボタンなどに見えている文字（そのまま。一部でもよい）を書く。JavaScript で作るボタン（textContent に入れる文字など）も、コードにある文字をそのまま使う（言い換えない。例: コードが「焼きへ（」+ 数 +「個）」なら「焼きへ」）。手順・見出しなどの、押せない文字と取り違えない。文字で見分けられないときだけ、HTMLにある CSS のセレクタ（#id や .class）を書く
- fill: target に入力欄のセレクタ（#id など）か、入力欄のラベルの文字を書き、value に入れる値を書く（自然な例。実在の人の名前・連絡先は使わない）
- drag: 指やマウスで動かして遊ぶツール（ドラッグで置く・動かす・canvas の上でなぞる など）で使う。target に押さえる要素（見えている文字か、#id などのセレクタ。canvas なら canvas のセレクタ）、dx・dy に動かす距離を、その要素の幅・高さに対する割合（-1〜1。右・下が正）で書く。押さえる位置を変えたいときだけ、from に要素の中の位置 [横, 縦]（0〜1。書かなければ真ん中）を書く。動かす先は要素の中に収める（なぞる帯を端から端までなぞるなら、from を [0.05, 0.5]、dx を 0.9 にする。真ん中から 0.8 右へは、帯の右端で止まり半分しか動かない）。動かすまで押せないボタンがあるツールは、そのボタンの前に drag を入れる
- wait: ms に待つ時間（300〜3000）。結果が出るまでに演出があるツールは、結果が見えるまで待つ
- 焼ける・育つ・たまる など、ツールの中で時間がたつのを待つ場面が長いときは、wait に fast（2〜${FAST_MAX}。何倍の速さで見せるか）を付けて早送りにする。ツールの中では ms の時間（${FAST_WAIT_MAX}まで）が進み、動画では ms÷fast の長さで済む（画面の隅に「早送り」と出る）。15秒に収まらないゲームも、早送りを使って、最後の結果の画面まで見せる（それでも収まらなければ、いちばん見せたい場面（できあがっていく様子など）で終える）。ボタンを押したあとの短い待ちには付けない
- 最初の3秒のうちに、いちばん面白い瞬間（結果・オチ）へ向かうように、前置きの操作は最小にする。steps は${PLAY_STEPS_MAX}個まで。最後は結果が画面に出ている状態で終える`;

// Claude Code がツールと一緒に書いた台本（ツールの HTML の <script type="application/json" id="lab-play">）
// 手順（steps）と、あれば動画の上の一言（hook）だけを持つ。投稿文の案はAIが書く（話題のハッシュタグの手がかりを使うため）
export type GivenPlay = { steps: PlayStep[]; hook?: string };
// 読めて、すべての手順がそのまま使えるときだけ台本にする。そうでなければ、何がだめかの文を返す（入れるときに断る）
export function parseGivenPlay(v: unknown): GivenPlay | string {
  if (!isObj(v) || !Array.isArray(v.steps)) return "steps（手順の配列）がありません";
  // 一言も、書いた値をそのまま使えるときだけ受け付ける（文字でない・前後に空白がある・長すぎるときは断る。PR #107 の ai-review の指摘）
  if (v.hook !== undefined && (typeof v.hook !== "string" || !v.hook.trim() || v.hook !== v.hook.trim() || v.hook.length > PLAY_HOOK_MAX)) return `hook（動画の上の一言）は、前後に空白のない${PLAY_HOOK_MAX}文字以内の文字にしてください`;
  const hook = typeof v.hook === "string" ? v.hook : undefined;
  const parsed = parsePlayScript({ hook: hook ?? "x", caption: "x", steps: v.steps });
  if (!parsed) return "押す・なぞる手順が1つもないか、手順の形が違います";
  if (v.steps.length > PLAY_STEPS_MAX) return `手順は${PLAY_STEPS_MAX}個までです（${v.steps.length}個あります）`;
  if (parsed.steps.length !== v.steps.length) return `${v.steps.length}個の手順のうち、${parsed.steps.length}個しか使えません（形が違う手順があるか、${PLAY_SECONDS_MAX}秒に収まりません）`;
  // 数の範囲などをそろえた手順が、書いたものと違うときも断る（書いた人が確かめた台本と、録画する台本を同じにするため）
  // 書いた値は、そろえたあとも同じでなければならない（範囲の外の値・使えない値は、変えられたり落とされたりする）。書かなかった値（dy など）は既定の値でよい
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const changed = (v.steps as unknown[]).some((raw, i) => !isObj(raw) || Object.keys(raw).some((k) => !same(raw[k], (parsed.steps[i] as Record<string, unknown>)[k])));
  if (changed) return "手順の値が決まりの範囲の外です（待つ時間・倍速・動かす割合などを確かめてください）";
  return { steps: parsed.steps, ...(hook ? { hook } : {}) };
}

const htmlHash = (html: string) => crypto.createHash("sha256").update(html).digest("hex");
// 入れたツールの HTML（台本の要素を除いたもの）と結び付けて残す。ツールを入れ直すと、新しい HTML の台本になる
export function savePlayScript(projectId: number, html: string, given: GivenPlay) {
  db().prepare("INSERT INTO play_scripts (project_id, html_hash, script) VALUES (?, ?, ?) ON CONFLICT(project_id, html_hash) DO UPDATE SET script = excluded.script, at = datetime('now')")
    .run(projectId, htmlHash(html), JSON.stringify(given));
}
// ツールを入れるときに、その HTML の台本を入れ替える（台本なしで入れ直したら消す）。戻す関数を返す（取り込みが失敗したときに、前の台本に戻すため。PR #107 の ai-review の指摘）
// 取り込みが終わってから残すのではなく先に入れ替えるのは、自動で公開する案件では、取り込みの途中で動画づくりが始まることがあるため
export function replacePlayScript(projectId: number, html: string, given: GivenPlay | null): () => void {
  const hash = htmlHash(html);
  const before = db().prepare("SELECT script, at FROM play_scripts WHERE project_id = ? AND html_hash = ?").get(projectId, hash) as { script: string; at: string } | undefined;
  if (given) savePlayScript(projectId, html, given);
  else db().prepare("DELETE FROM play_scripts WHERE project_id = ? AND html_hash = ?").run(projectId, hash);
  return () => {
    if (before) db().prepare("INSERT INTO play_scripts (project_id, html_hash, script, at) VALUES (?, ?, ?, ?) ON CONFLICT(project_id, html_hash) DO UPDATE SET script = excluded.script, at = excluded.at").run(projectId, hash, before.script, before.at);
    else db().prepare("DELETE FROM play_scripts WHERE project_id = ? AND html_hash = ?").run(projectId, hash);
  };
}
// 今のツールの HTML に結び付いた台本（なければ null。AIが台本を書く）
export function givenPlayScript(projectId: number, html: string): GivenPlay | null {
  const r = db().prepare("SELECT script FROM play_scripts WHERE project_id = ? AND html_hash = ?").get(projectId, htmlHash(html)) as { script: string } | undefined;
  if (!r) return null;
  const g = parseGivenPlay(JSON.parse(r.script));
  return typeof g === "string" ? null : g;
}

// given: Claude Code が書いた台本。手順はそのまま使い、AIは一言（なければ）と投稿文の案だけを書く
// prev: 前の台本（録画して問題があったとき、どこを直すかが分かるように渡す）
async function writePlayScript(p: ProjectRow, html: string, issues: string[] = [], opts: { given?: GivenPlay; prev?: PlayScript } = {}): Promise<PlayScript> {
  const { given, prev } = opts;
  const fixed = given ? `\n\nこのツールを作った人が、手元で録画して確かめた台本の手順がある。steps はこのまま返し、${given.hook ? "hook もこのまま返して、" : "hook と "}caption を書く:\n${JSON.stringify(given)}` : "";
  const before = prev ? `\n\n前の台本: ${JSON.stringify({ hook: prev.hook, steps: prev.steps })}` : "";
  const script = await callJson<PlayScript>({
    purpose: "遊ぶ様子の動画の台本",
    projectId: p.id,
    system: `あなたは短い縦長の動画（Xのタイムラインで流れる、10〜15秒ほど）の台本を書く担当です。動くツールを実際に遊ぶ様子を録画して、見た人が1秒で何をするものか分かり、遊んでみたくなる動画にします。
ツールのHTMLを読み、押すボタン・入れる値の順番（steps）を書きます。
${PLAY_STEP_RULES}
- hook: 動画の上に大きく出す一言（20文字以内）。何をするものか・何が起きるかが一言で分かるもの。誇大な表現・実在の人物や作品の名前は使わない
- caption: 投稿の本文の案（120文字以内。リンクは付けない（あとで付ける）。${tagRule(PLAY_TAG_MAX)}）
出力はJSONのみ: {"hook":"","steps":[{"do":"click","target":"回す"},{"do":"wait","ms":1500}],"caption":""}（ドラッグの例: {"do":"drag","target":"#board","from":[0.2,0.8],"dx":0.3,"dy":-0.3}。早送りの例: {"do":"wait","ms":8000,"fast":4}）`,
    user: `ツール名: ${p.title}\n対象: ${p.target}\n何ができるか: ${p.solution}${tagHints()}\n\nツールのHTML:\n${external(html.slice(0, 30_000))}${fixed}${before}${issues.length ? `\n\n前の台本で録画したら、次の問題があった。直した台本を書く:\n${issues.map((x) => `- ${x}`).join("\n")}` : ""}`,
    validate: (v): v is PlayScript => parsePlayScript(v) !== null,
  }).then((v) => parsePlayScript(v)!);
  return given ? { ...script, steps: given.steps, hook: given.hook ?? script.hook } : script;
}

// 上の帯の高さ（一言は2行まで入る）。ツールの枠の高さは (1920 - TOP - BOTTOM) / SCALE = 510px（#66 の動画で、一番下の一言が欠けたので 500px から少し高くした）
const TOP = 270;
const BOTTOM = 120;
// ツールの枠を 360px 幅で開き（ツールから見た画面の幅もスマホと同じ。幅で並びを変えるツールもスマホの並びになる）、枠ごと3倍にして映す
const SCALE = 3;
const PHONE_W = 1080 / SCALE;

// 下の帯に出すツール名。「ひだ包み職人 ― 餃子を包んで…」のような長い名前は、「―」より前だけにする（帯からはみ出して切れていた。#66 の動画）
export const bandTitle = (title: string) => title.split(/\s*[―—]\s*/)[0].trim() || title;

// 見えている文字・セレクタから、押す所・入れる所を探す
// wait: 見つからないとき、出てくるのを待つ長さ（録画の前は待たない。待つ間にもツールの時間が進み、台本とずれるため。PR #104 の ai-review の指摘）
// 押せる所（ボタン・リンクなど。ツールが「使った」と数える所と同じ考え方）。文字で探して見つけた所は、この中か、指の形のカーソルの所だけを押す
// 押せる役の印（role）は、メニューの項目・切り替え・木の形の一覧の項目も含める（PR #106 の ai-review の指摘）
const CLICKABLE = "button,a,summary,label,canvas,input,select,[onclick]," + ["button", "tab", "option", "slider", "link", "checkbox", "radio", "menuitem", "menuitemcheckbox", "menuitemradio", "switch", "treeitem", "gridcell", "combobox", "spinbutton"].map((r) => `[role=${r}]`).join(",");
async function find(frame: Frame, step: PlayStep, wait = FIND_WAIT_MS) {
  const t = step.target!;
  // clickable: 文字で探したときは、押しても何も起きない文字（手順の表示など）を押したことにしない
  // #66 で、台本の「焼く」が、ボタン「焼きへ（1個）」ではなく、上の手順の表示「包む → 焼く → 返す」の文字に当たり、押せたことになって先へ進めなかった
  const tries: { make: () => Locator; clickable?: boolean }[] = step.do === "fill"
    ? [{ make: () => frame.getByLabel(t, { exact: false }) }, { make: () => frame.getByPlaceholder(t, { exact: false }) }, { make: () => frame.locator(t) }]
    // 押せる所だけに絞るのは押す手順だけ（なぞる帯は、ボタンでも指の形のカーソルでもないことが多い。PR #106 の ai-review の指摘）
    : [{ make: () => frame.getByRole("button", { name: t, exact: false }) }, { make: () => frame.getByText(t, { exact: false }), clickable: step.do === "click" }, { make: () => frame.locator(t) }];
  // 同じ文字の候補が複数あるとき（PC用とスマホ用など）は、見えている最初のものを使う
  // 前の操作の演出（閉じる・切り替わるなど）のあとに出るボタンもあるので、少しのあいだ出てくるのを待つ（#66 の「焼きへ」）
  const until = Date.now() + wait;
  for (;;) {
    for (const { make, clickable } of tries) {
      try {
        const all = make();
        // 押せる所だけに絞るときは、同じ文字の押せない見出しが多くても見落とさないよう、先まで探す（PR #106 の ai-review の指摘）
        const n = Math.min(await all.count(), clickable ? 50 : 10);
        for (let i = 0; i < n; i++) {
          const l = all.nth(i);
          if (!(await l.isVisible())) continue;
          // JS で onclick を付けた要素（属性に出ない）も、その要素か親の要素にあれば押せる所とする（PR #106 の ai-review の指摘）
          if (clickable && !(await l.evaluate((el, sel) => {
            if (el.closest(sel) || getComputedStyle(el).cursor === "pointer") return true;
            for (let e: Element | null = el; e; e = e.parentElement) if ((e as HTMLElement).onclick) return true;
            return false;
          }, CLICKABLE))) continue;
          return l;
        }
      } catch {}
    }
    if (Date.now() >= until) return null;
    await frame.waitForTimeout(150);
  }
}

// いま見えているボタンの名前（押す所が見つからなかったとき、知らせに添える。台本を書き直すAIが、正しい名前を使えるように）
// 入力欄の形のボタン・リンクの役の要素も数える。名前は、正式な名前（ボタンの名前で探すときに使う名前）の決まりに近い順で取る:
// aria-labelledby の先の文字 → aria-label → 表の文字 → value → alt（画像の形の送信ボタン）→ 中の画像の alt（PR #106 の ai-review の指摘）
const BUTTON_LIKE = "button,[role=button],a,[role=link],input[type=button],input[type=submit],input[type=reset],input[type=image]";
async function visibleButtons(frame: Frame): Promise<string[]> {
  return frame.evaluate((sel) => Array.from(document.querySelectorAll(sel))
    .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden"; })
    .map((el) => ((el.getAttribute("aria-labelledby") || "").split(/\s+/).map((id) => (id && document.getElementById(id)?.textContent) || "").join(" ").trim()
      || el.getAttribute("aria-label") || (el as HTMLElement).innerText || (el as HTMLInputElement).value || el.getAttribute("alt")
      || el.querySelector("img[alt]")?.getAttribute("alt") || "").replace(/\s+/g, " ").trim().slice(0, 20))
    .filter(Boolean).slice(0, 8), BUTTON_LIKE).catch(() => []);
}

// 押す・なぞる所を、ツールの枠の見えている所に入れる（少しでも見えていると動かない scrollIntoViewIfNeeded は使わない）
// 枠の下の端に半分だけ出ている要素は、真ん中を押さえると枠の外（下の帯）を押してしまい、ツールに届かなかった（#66 の動画）
async function bringIntoView(l: Locator) {
  await l.evaluate((el) => el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" }), undefined, { timeout: 1500 });
}

// 台本どおりに遊ぶ様子を録画する。押す前に、指の印をその場所へ動かす（何を押したか分かるように）
// 返す shots は、最初・途中・最後の画面（AIの確かめに使う。録画には入らない）
export async function renderPlay(script: PlayScript, toolHtml: string, opts: { data?: unknown[]; fonts?: boolean; illustration?: string; images?: ToolImages }, title: string, out: string): Promise<{ done: number; failed: string[]; shots: Buffer[] }> {
  const browser = await launch();
  if (typeof browser === "string") throw new Error(browser);
  try {
    const ctx = await browser.newContext({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1, locale: "ja-JP" });
    const page = await ctx.newPage();
    // 早送りで待つ台本のときだけ、ページの時計（時刻・タイマー・アニメーションの合図）を、こちらで進められるものに替える
    // 替えても時間はふつうに流れ、早送りの間だけ、こちらで先へ進める（ツールの枠の中にも効く）
    const fastForward = script.steps.some((s) => s.fast);
    if (fastForward) await page.clock.install();
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
    await page.setContent(`<!doctype html><meta charset="utf-8"><style>
*{margin:0;box-sizing:border-box}html,body{width:1080px;height:1920px;overflow:hidden;background:#fff;font-family:"Hiragino Sans","Noto Sans CJK JP",sans-serif}
#top{position:absolute;top:0;left:0;width:1080px;height:${TOP}px;display:flex;align-items:center;justify-content:center;text-align:center;padding:0 56px;background:#111;color:#fff;font-size:76px;font-weight:800;line-height:1.3}
#bottom{position:absolute;bottom:0;left:0;width:1080px;height:${BOTTOM}px;display:flex;align-items:center;justify-content:center;padding:0 48px;background:#111;color:#bbb;font-size:40px;font-weight:700}
#bottom span{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
iframe{position:absolute;top:${TOP}px;left:0;width:${PHONE_W}px;height:${(1920 - TOP - BOTTOM) / SCALE}px;border:0;background:#fff;transform:scale(${SCALE});transform-origin:0 0}
#ff{position:absolute;top:${TOP + 28}px;right:28px;padding:10px 26px;border-radius:999px;background:rgba(17,17,17,.78);color:#fff;font-size:44px;font-weight:800;display:none;z-index:6}
#finger{position:absolute;width:96px;height:96px;margin:-48px 0 0 -48px;border-radius:50%;background:rgba(255,80,80,.45);border:6px solid rgba(255,255,255,.9);box-shadow:0 4px 18px rgba(0,0,0,.35);opacity:0;transition:left .3s ease,top .3s ease,opacity .2s,transform .12s;z-index:5;pointer-events:none}
</style><div id="top">${esc(script.hook || title)}</div><iframe id="f"></iframe><div id="bottom"><span>${esc(bandTitle(title))}｜登録なしで遊べる</span></div><div id="ff">▶▶ 早送り</div><div id="finger"></div>`);
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
      await page.waitForTimeout(FINGER_MS);
      await page.evaluate(() => { document.getElementById("finger")!.style.transform = "scale(.8)"; });
      await page.waitForTimeout(120);
      await page.evaluate(() => { document.getElementById("finger")!.style.transform = "scale(1)"; });
    };
    // ドラッグ: 指の印を押さえる所へ動かし、押さえたまま動かす先まで滑らせて離す（指の印も一緒に動く）
    // 動かす先は、押さえた要素の大きさに対する割合で決める（ツールの中の位置を、台本から画素で書かせないため）
    // ツールの枠の、画面に映っている所（押さえる・動かす先は、この中に収める。外は上下の帯で、ツールに届かない）
    const view = await frameEl.boundingBox();
    if (!view) throw new Error("ツールの枠の位置が分かりませんでした");
    const drag = async (box: { x: number; y: number; width: number; height: number }, step: PlayStep) => {
      const [fx, fy] = step.from ?? [0.5, 0.5];
      // 枠の右端・下端は枠の内側に入らないので、押さえる位置は端から1画素だけ内側に収める（from が 0・1 でも、その要素を押さえる。PR #95 の ai-review の指摘）
      const inside = (v: number, size: number) => Math.min(Math.max(v, 1), Math.max(1, size - 1));
      const within = (v: number, lo: number, size: number) => Math.min(Math.max(v, lo + 1), lo + size - 1);
      // 要素が枠より大きく、押さえる位置が映っていないときは、要素の映っている所に寄せる。要素がまったく映っていなければ、押さえない
      const top = Math.max(box.y, view.y), bottom = Math.min(box.y + box.height, view.y + view.height);
      const left = Math.max(box.x, view.x), right = Math.min(box.x + box.width, view.x + view.width);
      if (bottom - top < 2 || right - left < 2) throw new Error("押さえる所が画面に映っていない");
      const sx = within(box.x + inside(box.width * fx, box.width), left, right - left), sy = within(box.y + inside(box.height * fy, box.height), top, bottom - top);
      const ex = within(sx + box.width * (step.dx ?? 0), view.x, view.width), ey = within(sy + box.height * (step.dy ?? 0), view.y, view.height);
      const finger = (x: number, y: number) => page.evaluate(({ x, y }) => { const f = document.getElementById("finger")!; f.style.left = `${x}px`; f.style.top = `${y}px`; }, { x, y });
      await page.evaluate(({ x, y }) => { const f = document.getElementById("finger")!; f.style.opacity = "1"; f.style.left = `${x}px`; f.style.top = `${y}px`; }, { x: sx, y: sy });
      await page.waitForTimeout(FINGER_MS);
      await page.evaluate(() => { const f = document.getElementById("finger")!; f.style.transform = "scale(.8)"; f.style.transition = "opacity .2s, transform .12s"; });
      await page.mouse.move(sx, sy);
      await page.mouse.down();
      const n = 18;
      for (let k = 1; k <= n; k++) {
        // 初めはゆっくり、途中で速く、最後はゆっくり（手で動かしたように見せる）
        const t = (1 - Math.cos((Math.PI * k) / n)) / 2;
        const x = sx + (ex - sx) * t, y = sy + (ey - sy) * t;
        await page.mouse.move(x, y);
        await finger(x, y);
        await page.waitForTimeout(DRAG_MS / n);
      }
      await page.mouse.up();
      await page.evaluate(() => { const f = document.getElementById("finger")!; f.style.transform = "scale(1)"; f.style.transition = ""; });
    };
    // 最初に操作する所が、初めから見えているようにする（枠の下の端で帯に隠れたまま始まらないように。#66 の動画）
    const first = script.steps.find((s) => s.do !== "wait");
    // 今見えているときだけ動かす（出てくるのを待たない）
    const firstEl = first ? await find(frame, first, 0) : null;
    if (firstEl) await bringIntoView(firstEl).catch(() => undefined);
    await page.waitForTimeout(200);
    shots.push(await page.screenshot({ type: "jpeg", quality: 70 }));
    // 早送りで待つ: 時間はふつうに流しつつ、0.1秒ごとに残りを先へ進めて、ツールの中で ms の時間を進める（動画では ms÷fast の長さ）
    // 先へ進める間に重い描き直しがあると、動画の方が少し長くなるが、ツールの中の時間は ms ちょうどにする（結果の出る時刻を台本どおりにするため）
    const fastWait = async (ms: number, fast: number) => {
      await page.evaluate((x) => { const b = document.getElementById("ff")!; b.textContent = `▶▶ 早送り ×${x}`; b.style.display = "block"; }, fast);
      // 1回に待つ実時間は、0.1秒か「残り÷倍速」の短い方（短い早送りでも、実時間が ms÷fast を超えないように。PR #104 の ai-review の指摘）
      let passed = 0;
      while (passed < ms) {
        const tick = Math.max(1, Math.min(100, (ms - passed) / fast));
        await page.waitForTimeout(tick);
        passed += tick;
        const jump = Math.min(tick * (fast - 1), ms - passed);
        if (jump > 0) await page.clock.runFor(jump);
        passed += jump;
      }
      await page.evaluate(() => { document.getElementById("ff")!.style.display = "none"; });
    };
    // 途中のコマは、真ん中の手順のあとに、うまくいったかにかかわらず必ず撮る（コマは最初・途中・最後の3枚にそろえる）
    const mid = Math.floor((script.steps.length - 1) / 2);
    // 確かめ用のコマ（AIに見せる。録画には入らない）は、押す所を示す赤い丸を消して撮る
    // 丸が文字に重なると「読めない」と指摘され、その指摘を直そうとしたAIが台本の手順を壊した（#66 の動画）。動画の方には丸を残す
    const checkShot = async () => {
      await page.evaluate(() => { const f = document.getElementById("finger")!; f.dataset.o = f.style.opacity; f.style.transition = "none"; f.style.opacity = "0"; });
      shots.push(await page.screenshot({ type: "jpeg", quality: 70 }));
      await page.evaluate(() => { const f = document.getElementById("finger")!; f.style.opacity = f.dataset.o ?? ""; f.style.transition = ""; });
    };
    const midShot = async (hold: (fn: () => Promise<void>) => Promise<void>) => hold(checkShot);
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
            if (step.fast && fastForward) await fastWait(step.ms ?? 800, step.fast);
            else await page.waitForTimeout(step.ms ?? 800);
            continue;
          }
          const l = await find(frame, step);
          if (!l) {
            // 添えるのは押す手順だけ（なぞる所が見つからないときにボタンを候補と取り違えないように。PR #106 の ai-review の指摘）
            const names = step.do === "click" ? await visibleButtons(frame) : [];
            failed.push(`${i + 1}番目の「${step.target}」が見つからなかった${names.length ? `（見えているボタン: ${names.join("・")}）` : ""}`);
            continue;
          }
          try {
            await bringIntoView(l);
            const box = await l.boundingBox();
            if (step.do === "drag") {
              if (!box) throw new Error("押さえる所の位置が分からない");
              await drag(box, step);
              done++;
              await page.waitForTimeout(STEP_PAUSE_MS);
              continue;
            }
            if (box) await tap(box);
            // 入れられない・押せない所（止められている・ほかの要素に覆われているなど）は、短い時間で諦めて次へ進む
            if (step.do === "fill") {
              await l.fill("", { timeout: 1500 });
              await l.pressSequentially(step.value ?? "", { delay: 70, timeout: 1500 + 100 * (step.value ?? "").length });
            } else await l.click({ timeout: 1500 });
            done++;
            await page.waitForTimeout(STEP_PAUSE_MS);
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
      await hold(checkShot);
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
      { type: "text", text: `ツール名: ${p.title}\n上の一言: ${script.hook}\n台本: ${script.steps.map((s) => (s.do === "wait" ? `待つ${s.ms}ms${s.fast ? `（${s.fast}倍の早送り）` : ""}` : s.do === "drag" ? `動かす「${s.target}」` : `${s.do === "fill" ? "入力" : "押す"}「${s.target}」${s.value ? `に「${s.value}」` : ""}`)).join(" → ")}` },
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
    const opts = { data: tool.data, fonts: tool.fonts, illustration: lp.design?.illustration?.url, images: tool.images };
    // Claude Code がツールと一緒に書いた台本があれば、その手順で録画する（AIは一言と投稿文の案だけを書く）
    const given = givenPlayScript(p.id, tool.html);
    if (given) logEvent(p.id, "system", "play-video", "ツールを作った人（Claude Code）が書いた台本の手順で録画します");
    let script = await writePlayScript(p, tool.html, [], given ? { given } : {});
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
      // 1回目の確かめの指摘も経過に残す（最後の回の指摘しか残らず、撮り直しで何が変わったかを追えなかったため。#66 の動画）
      logEvent(p.id, "ai", "play-video", `遊ぶ様子の動画の1回目の確かめで問題があったため、撮り直します: ${check.issues.join(" / ").slice(0, 300)}`);
      // ツールを作った人が確かめた台本があるときは、撮り直しでも手順は変えない（AIは一言と投稿文の案だけを書き直す）
      // #66 では、見た目の指摘を直そうとしたAIが「ふたを開ける」を使えない手順に書き換え、最後まで届かなくなった
      script = await writePlayScript(p, tool.html, check.issues, given ? { given, prev: script } : { prev: script });
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
// 設定の「公開したときに動画を自動で作る」がオンのときだけ（運営者が、必要なときだけ作れればよいと決めた。案件の画面のボタンからはいつでも作れる）
export function makePlayVideoOnPublish(p: Pick<ProjectRow, "id" | "kind" | "aim">) {
  const s = getSettings();
  if (!s.playVideoOnPublish || p.kind !== "tool" || p.aim !== "spread" || s.killSwitch || pending.has(p.id)) return;
  void makePlayVideo(p.id).catch((e) => logEvent(p.id, "system", "play-video-error", `遊ぶ様子の動画を作れませんでした: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`));
}
