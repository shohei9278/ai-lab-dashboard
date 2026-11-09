import path from "node:path";
import { callJson, isObj, isStr } from "./ai";
import { dataDir, db, getSettings } from "./db";
import type { DiaryContent } from "./diary";
import { headline } from "./experiment";
import { launch } from "./freePage";
import { logEvent } from "./loop";
import { modelInfo } from "./models";
import { RECORD_VIDEO_KINDS, type RecordVideoKind } from "./recordVideoKinds";
import { recordToMp4 } from "./videoRender";

// 実験の記録の動画: 本物の記録だけを材料に、AIが短い台本を書き、縦長の動画にする。投稿は人が手で行う
// 運営者が書いた文や外の人の声は材料に入れない（動画は外に出るため）

export type RecordScene = { who: string | null; label: string; text: string; number?: string };
type Script = { hook: string; scenes: RecordScene[]; end: string; caption: string };
export type RecordVideoRow = { id: number; at: string; kind: RecordVideoKind; title: string; caption: string; file: string; model_id: string; script: string };

export const listRecordVideos = (limit = 8) => db().prepare("SELECT * FROM record_videos ORDER BY id DESC LIMIT ?").all(limit) as RecordVideoRow[];

export function recordVideoPath(file: string): string | null {
  return /^record-\d+\.mp4$/.test(file) ? path.join(dataDir("videos"), file) : null;
}

function material(kind: RecordVideoKind): string {
  const s = getSettings();
  const h = headline();
  const base = `この会社: Claude・GPT・Gemini の3社のAIを社員にして、Webツールを作って公開している実験。
ここまでの累計: 案件${h.projects}件・公開${h.published}件・訪問${h.visits}人・登録/利用${h.conversions}件・AI費用 約${Math.round(h.aiJpy)}円`;
  if (kind === "day") {
    const d = db().prepare("SELECT day, model_id, content FROM daily_reports ORDER BY day DESC LIMIT 1").get() as { day: string; model_id: string; content: string } | undefined;
    if (!d) throw new Error("日報がまだないため、今日の結果の動画は作れません");
    const c = JSON.parse(d.content) as DiaryContent;
    const n = c.numbers;
    return `${base}\n\n${d.day}の日報（書いたAI: ${d.model_id}）\n見出し: ${c.headline}\n予定 ${n.total}件のうち済み ${n.done}件 / 訪問 ${n.visits}人${n.predictedVisits !== null ? `（朝の予想 ${n.predictedVisits}人）` : ""} / 登録・利用 ${n.conversions}件${n.predictedConversions !== null ? `（朝の予想 ${n.predictedConversions}件）` : ""}\nやったこと: ${c.did.join(" / ")}\n分かったこと: ${c.learned.join(" / ")}\nできなかったこと: ${c.failed.join(" / ")}\n明日: ${c.tomorrow}`;
  }
  if (kind === "debate") {
    const m = db().prepare("SELECT at, kind, topic, chair_model, content FROM meetings ORDER BY id DESC LIMIT 1").get() as { at: string; kind: string; topic: string | null; chair_model: string; content: string } | undefined;
    if (!m) throw new Error("会議の記録がまだないため、議論の動画は作れません");
    const c = JSON.parse(m.content) as { rounds?: { modelId: string; opinion: string; final?: string; changed?: boolean }[]; conclusion?: string; members?: { modelId: string; review: string }[]; ranked?: { title: string; proposer: string; score: number }[]; summary?: string };
    const body = c.rounds
      ? `議題: ${m.topic}\n${c.rounds.map((r) => `${r.modelId}\n- 最初の意見: ${r.opinion}\n- 最終的な意見${r.changed ? "（考えを変えた）" : ""}: ${r.final ?? "なし"}`).join("\n")}\n結論（議長 ${m.chair_model}）: ${c.conclusion ?? ""}`
      : `週の定例会議\n${(c.members ?? []).map((x) => `${x.modelId}の振り返り: ${x.review}`).join("\n")}\n出た案と点数: ${(c.ranked ?? []).slice(0, 6).map((p) => `${p.title}（${p.proposer}・${p.score}点）`).join(" / ")}\n議長 ${m.chair_model} のまとめ: ${c.summary ?? ""}`;
    return `${base}\n\n${body}`.slice(0, 7000);
  }
  const rows = db().prepare(
    `SELECT a.purpose, a.model_id, a.error, a.cost_usd, p.title FROM ai_calls a LEFT JOIN projects p ON p.id = a.project_id
     WHERE a.error IS NOT NULL AND a.cost_usd > 0 AND a.at >= datetime('now', '-14 days') ORDER BY a.cost_usd DESC LIMIT 8`,
  ).all() as { purpose: string; model_id: string; error: string; cost_usd: number; title: string | null }[];
  if (!rows.length) throw new Error("直近14日に費用のかかった失敗がないため、失敗談の動画は作れません");
  return `${base}\n\n直近14日のAIの失敗（費用が大きい順）:\n${rows.map((r) => `- ${r.purpose}（${r.model_id}${r.title ? `・案件「${r.title}」` : ""}）: ${r.error.slice(0, 80)} / 無駄になった費用 約${Math.round(r.cost_usd * s.usdJpy)}円`).join("\n")}`;
}

// 台本の数字が、すべて材料にある数字かを確かめる（作り話を防ぐ）
const numbersOf = (t: string) => (t.replace(/(\d),(\d)/g, "$1$2").match(/\d+(?:\.\d+)?/g) ?? []);
function numbersFromMaterial(script: Script, mat: string): boolean {
  const known = new Set(numbersOf(mat));
  const all = [script.hook, script.end, ...script.scenes.flatMap((x) => [x.text, x.label, x.number ?? ""])];
  return all.flatMap(numbersOf).every((n) => known.has(n));
}

async function writeScript(kind: RecordVideoKind, mat: string): Promise<Script> {
  const speakers = ["claude-opus-5-5", "claude-sonnet-5-5", "gpt-5.6-sol", "gemini-3.1-pro-preview"];
  return callJson<Script>({
    purpose: "記録動画の台本",
    system: `あなたは「AIを社員にした会社の実験」の記録を、20〜30秒の縦長の動画（音なし・字幕だけ）の台本にします。今回の題材は「${RECORD_VIDEO_KINDS[kind]}」です。実験を知らない人が途中でやめずに見られるようにします。
書くもの:
- hook: 最初に大きく出す一言（22文字以内）。一番意外な事実をそのまま言う
- scenes: 3〜5場面。label は小見出し（12文字以内）、text は本文（55文字以内）、number は大きく見せたい数字があるときだけ（例「96円」）。who は発言しているAIのID（${speakers.join(" / ")}）。発言でなければ null
- end: 最後の一言（22文字以内）
- caption: 投稿に添える文（120文字以内、ハッシュタグ2つまで）
守ること:
- 材料にある事実・数字だけを書く。材料にない数字は1つも書かない
- AIの発言は、材料にある言葉を短くしたものだけ。発言を作らない
- うまくいっていないことは、うまくいっていないまま書く。煽らない
- 人の感想・体験は書かない。ツールの宣伝やリンクの案内はしない
- 専門用語は使わない
形式: {"hook":"","scenes":[{"who":null,"label":"","text":"","number":""}],"end":"","caption":""}`,
    user: mat,
    validate: (v): v is Script => {
      if (!isObj(v) || !isStr(v.hook) || !isStr(v.end) || !isStr(v.caption) || !Array.isArray(v.scenes) || v.scenes.length < 2) return false;
      if (!v.scenes.every((x) => isObj(x) && isStr(x.text))) return false;
      return numbersFromMaterial(v as unknown as Script, mat);
    },
  });
}

const COLOR: Record<string, string> = { anthropic: "#e08a5a", openai: "#35b48c", google: "#5b8def" };

function html(data: unknown): string {
  // 文字はすべて textContent で入れる
  return `<!doctype html><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0}html{zoom:2}html,body{width:540px;height:960px;overflow:hidden;background:#101216;color:#f4f4f2;font-family:"Hiragino Sans","Noto Sans CJK JP",sans-serif}
#tag{position:absolute;top:44px;left:0;width:100%;text-align:center;font-size:19px;color:#a7abb3;font-weight:600}
#s{position:absolute;inset:110px 34px 90px;display:flex;flex-direction:column;justify-content:center;opacity:0;transition:opacity .22s}
#big{font-size:50px;font-weight:800;line-height:1.35;text-align:center;white-space:pre-wrap}
#who{display:none;align-items:center;gap:12px;margin-bottom:18px}#av{width:54px;height:54px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:22px;color:#fff}#name{font-size:24px;font-weight:700}
#label{font-size:24px;font-weight:700;color:#a7abb3;margin-bottom:14px}#num{font-size:96px;font-weight:800;line-height:1.1;margin-bottom:14px}
#text{font-size:37px;font-weight:700;line-height:1.5;min-height:170px;white-space:pre-wrap}
#bar{position:absolute;left:34px;right:34px;bottom:44px;height:5px;background:#2b2f37;border-radius:3px}#fill{height:100%;width:0;background:#f4f4f2;border-radius:3px;transition:width .3s}
</style><div id="tag">AIを社員にした会社の実験</div><div id="s"></div><div id="bar"><div id="fill"></div></div>
<script>
const D=${JSON.stringify(data).replace(/</g, "\\u003c")};const $=(t,id)=>{const e=document.createElement(t);if(id)e.id=id;return e};
window.show=(i)=>new Promise(done=>{const s=document.getElementById('s');s.style.opacity=0;
setTimeout(()=>{s.innerHTML='';const c=D.cards[i];document.getElementById('fill').style.width=((i+1)/D.cards.length*100)+'%';
if(c.big){const b=$('div','big');b.textContent=c.big;s.append(b);s.style.opacity=1;return done();}
if(c.who){const w=$('div','who');w.style.display='flex';const a=$('div','av');a.style.background=c.who.color;a.textContent=c.who.mark;const n=$('div','name');n.textContent=c.who.name;w.append(a,n);s.append(w);}
if(c.label){const l=$('div','label');l.textContent=c.label;s.append(l);}
if(c.number){const n=$('div','num');n.textContent=c.number;s.append(n);}
const t=$('div','text');s.append(t);s.style.opacity=1;const chars=[...c.text];let k=0;
const iv=setInterval(()=>{t.textContent=chars.slice(0,++k).join('');if(k>=chars.length){clearInterval(iv);done();}},38);},230);});
</script>`;
}

const g = globalThis as unknown as { __aiLabRecordVideo?: boolean };

export async function createRecordVideo(kind: RecordVideoKind): Promise<number> {
  if (!RECORD_VIDEO_KINDS[kind]) throw new Error("動画の種類が正しくありません");
  if (g.__aiLabRecordVideo) throw new Error("いま別の動画を作っています。終わってから試してください");
  g.__aiLabRecordVideo = true;
  try {
    const mat = material(kind);
    const script = await writeScript(kind, mat);
    const cards = [
      { big: script.hook.slice(0, 40) },
      ...script.scenes.slice(0, 5).map((x) => {
        const known = x.who && /^(claude|gpt|gemini)/.test(x.who) ? modelInfo(x.who) : null;
        return {
          who: known ? { name: known.label, mark: known.provider === "anthropic" ? "C" : known.provider === "openai" ? "G" : "Gm", color: COLOR[known.provider] ?? "#888" } : null,
          label: known ? "" : String(x.label ?? "").slice(0, 20),
          number: isStr(x.number) && x.number.trim() ? x.number.trim().slice(0, 10) : "",
          text: x.text.slice(0, 80),
        };
      }),
      { big: script.end.slice(0, 40) },
    ];
    const browser = await launch();
    if (typeof browser === "string") throw new Error(browser);
    const file = `record-${Date.now()}.mp4`;
    try {
      const ctx = await browser.newContext({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1, locale: "ja-JP" });
      const page = await ctx.newPage();
      await page.setContent(html({ cards }));
      // 最初の画面を出してから撮り始める（冒頭が真っ黒にならないように）
      await page.evaluate("window.show(0)");
      await page.waitForTimeout(350);
      await recordToMp4(page, async () => {
        for (let i = 0; i < cards.length; i++) {
          if (i > 0) await page.evaluate("window.show(" + i + ")");
          const c = cards[i] as { big?: string; text?: string; number?: string };
          // 読み終わるまで止める
          await page.waitForTimeout(c.big ? 2300 : Math.max(1500, (c.text?.length ?? 0) * 55 + (c.number ? 500 : 0)));
        }
      }, recordVideoPath(file)!);
    } finally {
      await browser.close();
    }
    const modelId = getSettings().loopModel;
    const id = Number(db().prepare("INSERT INTO record_videos (kind, title, caption, file, model_id, script) VALUES (?, ?, ?, ?, ?, ?)")
      .run(kind, script.hook.slice(0, 60), script.caption.slice(0, 200), file, modelId, JSON.stringify(script)).lastInsertRowid);
    logEvent(null, "ai", "record-video", `実験の記録の動画を作りました（${RECORD_VIDEO_KINDS[kind]}）: ${script.hook.slice(0, 40)}`);
    return id;
  } finally {
    g.__aiLabRecordVideo = false;
  }
}
