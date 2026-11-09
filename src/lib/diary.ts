import fs from "node:fs";
import path from "node:path";
import { callJson, isObj, isStr } from "./ai";
import { dataDir, db, getSettings } from "./db";
import { launch } from "./freePage";
import { logEvent } from "./loop";
import { modelInfo } from "./models";
import { BOTTLENECK_LABEL, TASK_KIND_LABEL, planFor, planProgress } from "./plan";
import { jstDay } from "./sns";

// 日報: 毎晩（その日の投稿が終わる22時以降）、朝会の担当AIが1日の結果を書く。朝の計画と違い「実際にどうだったか」の記録
// あわせて、運営者が自分の note に貼る下書きと、貼る画像（今日の数字カード・その日に公開や改善をしたページの画面）を作る
// note には自動で投稿できないので、コピーして運営者が投稿する。運営者の感想は作らず、書いてもらう欄を残す

export type DiaryContent = {
  headline: string;
  did: string[];
  learned: string[];
  failed: string[];
  tomorrow: string;
  numbers: { done: number; total: number; visits: number; conversions: number; predictedVisits: number | null; predictedConversions: number | null; bottleneck: string };
};
export type DiaryImage = { file: string; label: string };
export type DiaryRow = { id: number; day: string; created_at: string; model_id: string; content: string; note_title: string; note_body: string; images: string };

export function listDiaries(limit = 60): DiaryRow[] {
  return db().prepare("SELECT * FROM daily_reports ORDER BY day DESC LIMIT ?").all(limit) as DiaryRow[];
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);

// 今日の数字カード（note に貼る画像）。作れなければ null（画像なしで日報は残す）
async function statCard(day: string, c: DiaryContent, model: string): Promise<DiaryImage | null> {
  const browser = await launch();
  if (typeof browser === "string") return null;
  try {
    const n = c.numbers;
    const tile = (label: string, value: string, sub = "") => `<div class="t"><div class="l">${esc(label)}</div><div class="v">${esc(value)}</div><div class="s">${esc(sub)}</div></div>`;
    const html = `<!doctype html><meta charset="utf-8"><style>
      *{box-sizing:border-box;margin:0}body{width:1200px;height:630px;padding:56px 64px;background:#f7f5f0;color:#1d1d1f;font-family:"Noto Sans CJK JP","Noto Sans JP","Hiragino Sans",sans-serif;display:flex;flex-direction:column;gap:28px}
      .d{font-size:26px;color:#6b6b6b}.h{font-size:46px;font-weight:700;line-height:1.35;flex:1;overflow:hidden}.g{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}
      .t{background:#fff;border-radius:18px;padding:22px 26px}.l{font-size:22px;color:#6b6b6b}.v{font-size:52px;font-weight:700;margin-top:4px}.s{font-size:20px;color:#6b6b6b;height:26px}.f{font-size:22px;color:#6b6b6b}
    </style><div class="d">${esc(day.replaceAll("-", "/"))} のAIの日報</div><div class="h">${esc(c.headline)}</div>
    <div class="g">${tile("訪問", `${n.visits}人`, n.predictedVisits !== null ? `AIの予想 ${n.predictedVisits}人` : "")}${tile("登録・利用", `${n.conversions}人`, n.predictedConversions !== null ? `AIの予想 ${n.predictedConversions}人` : "")}${tile("今日の予定", `${n.done}/${n.total}件`, `ネック: ${n.bottleneck}`)}</div>
    <div class="f">AIを社員にした、小さなプロダクト会社の実験（担当: ${esc(model)}）</div>`;
    const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
    await page.setContent(html, { waitUntil: "load", timeout: 15_000 });
    const file = `diary-${day}.png`;
    await page.screenshot({ path: path.join(dataDir("screenshots"), file), timeout: 10_000 });
    return { file, label: "今日の数字カード" };
  } catch (e) {
    logEvent(null, "system", "diary-error", `数字カードの画像を作れませんでした: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`);
    return null;
  } finally {
    await browser.close().catch(() => {});
  }
}

// その日に公開・改善したページの、すでに撮ってある画面（2件まで）
function pageShots(day: string): DiaryImage[] {
  const rows = db().prepare(
    "SELECT DISTINCT e.project_id AS id, p.title FROM events e JOIN projects p ON p.id = e.project_id WHERE p.demo = 0 AND e.kind IN ('publish', 'auto-publish', 'auto-improve') AND date(e.at, '+9 hours') = ? ORDER BY e.id DESC LIMIT 2",
  ).all(day) as { id: number; title: string }[];
  return rows.flatMap((p) => {
    const v = db().prepare("SELECT test FROM lp_versions WHERE project_id = ? AND test IS NOT NULL ORDER BY version DESC LIMIT 1").get(p.id) as { test: string } | undefined;
    if (!v) return [];
    const t = JSON.parse(v.test) as { pc?: string; shots?: string[]; screenshot?: string };
    const file = t.pc ?? t.shots?.[0] ?? t.screenshot;
    return file && fs.existsSync(path.join(dataDir("screenshots"), file)) ? [{ file, label: `${p.title} の画面` }] : [];
  });
}

const PLACEHOLDER = "【ここに感想を記載";

export async function createDiary({ force = false } = {}): Promise<number> {
  const day = jstDay();
  const existing = db().prepare("SELECT id FROM daily_reports WHERE day = ?").get(day) as { id: number } | undefined;
  if (existing && !force) return existing.id;
  const plan = planFor(day);
  if (!plan) throw new Error("今日の計画がないため、日報を書けません");
  const g = planProgress(plan);
  const bottleneck = BOTTLENECK_LABEL[g.content.bottleneck].split("（")[0];
  const q = (sql: string) => db().prepare(sql).all(day) as Record<string, string>[];
  const events = q("SELECT message FROM events WHERE date(at, '+9 hours') = ? AND actor != 'human' AND kind NOT LIKE '%error%' AND kind NOT IN ('sns-draft', 'plan-task', 'backup') ORDER BY id DESC LIMIT 40");
  const voices = q("SELECT scene, text FROM voices WHERE date(at, '+9 hours') = ? ORDER BY id DESC LIMIT 12");
  const outside = q("SELECT source, choice, text FROM external_voices WHERE date(at, '+9 hours') = ? ORDER BY id DESC LIMIT 12");
  const research = q("SELECT question, status, summary FROM research WHERE date(at, '+9 hours') = ? ORDER BY id DESC LIMIT 3");
  const effects = q("SELECT scene, change FROM voice_effects WHERE date(at, '+9 hours') = ? ORDER BY id DESC LIMIT 6");
  const images0 = pageShots(day);
  const hasShot = images0.length > 0;
  const out = await callJson<Omit<DiaryContent, "numbers"> & { note: { title: string; body: string } }>({
    purpose: "日報",
    modelId: plan.model_id,
    system: `あなたは「AIを社員にした、小さなプロダクト会社の実験」の、今日の朝会の担当です。1日の終わりに、朝の計画に対して実際にどうだったかを日報に書きます。日報は誰でも読めるページに載ります。
- headline: 今日を1文で（40文字以内。カードの画像の見出しになる）
- did: 実際にやったこと（2〜4件。予定だけで実行していないものは書かない）
- learned: 分かったこと（0〜3件。件数が少ないときは「まだ偶然の可能性が高い」と添える）
- failed: 効かなかった・できなかったこと（0〜3件。隠さない）
- tomorrow: 明日どう変えるか（1〜2文）
- note: 運営者（人）が自分の note に貼る日記の下書き。title と body（Markdown、300〜600字）
  - 「AIに会社を任せている運営者」の一人称で書く。ただし運営者の感想・気持ち・体験は作らない。事実（AIが何をして、数字がどうだったか）だけを書く
  - 運営者に感想を書いてほしい所に、「${PLACEHOLDER}：何について書く欄か】」を2〜3か所置く（例: 【ここに感想を記載：AIの判断で意外だったこと】）
  - 画像を入れる位置に「[画像: 今日の数字カード]」を1か所置く${hasShot ? "。「[画像: ページの画面]」も1か所置く" : ""}
  - URLは書かない
守ること: 数字と出来事は材料にあるものだけを使う。利用者が書いた文はそのまま引用せず要約する。作り話をしない
形式: {"headline":"","did":[""],"learned":[""],"failed":[""],"tomorrow":"","note":{"title":"","body":""}}`,
    user: `今日: ${day}
朝の方針: ${g.content.focus}（今のネック: ${bottleneck}）
予定: ${g.done}/${g.total}件 済み（失敗${g.failed}・見送り${g.skipped}・承認待ち${g.held}）
${g.tasks.map((t) => `- ${t.at_time} ${TASK_KIND_LABEL[t.kind]}${t.platform ? `(${t.platform})` : ""}「${(t.angle ?? "").slice(0, 60)}」→ ${t.status}`).join("\n")}
目標と実測: ${g.goals.map((x) => `${x.metric} ${x.actual}/${x.target}`).join("・") || "なし"}
朝の予想: ${g.prediction ? `訪問${g.prediction.visits}人・登録/利用${g.prediction.conversions}人 → 実測 訪問${g.actual.visits}人・登録/利用${g.actual.conversions}人` : "なし"}

今日の出来事:
${events.map((e) => `- ${e.message.slice(0, 140)}`).join("\n") || "（なし）"}

外の声（実際の人の反応）:
${outside.map((v) => `- ${v.source} ${v.choice ?? ""} ${v.text.slice(0, 100)}`).join("\n") || "（なし）"}

調べたこと:
${research.map((r) => `- ${r.question} → ${r.status}: ${(r.summary ?? "").slice(0, 200)}`).join("\n") || "（なし）"}

外の声・調べたことで変えた判断:
${effects.map((e) => `- ${e.scene}: ${e.change}`).join("\n") || "（なし）"}

社員のひとこと:
${voices.map((v) => `- ${v.scene}: ${v.text}`).join("\n") || "（なし）"}`,
    validate: (v): v is Omit<DiaryContent, "numbers"> & { note: { title: string; body: string } } => isObj(v) && isStr(v.headline) && Array.isArray(v.did) && isObj(v.note) && isStr(v.note.title) && isStr(v.note.body),
  });
  const list = (x: unknown) => (Array.isArray(x) ? x.filter(isStr).slice(0, 4).map((t) => t.slice(0, 200)) : []);
  const content: DiaryContent = {
    headline: out.headline.slice(0, 60), did: list(out.did), learned: list(out.learned), failed: list(out.failed), tomorrow: String(out.tomorrow ?? "").slice(0, 300),
    numbers: { done: g.done, total: g.total, visits: g.actual.visits, conversions: g.actual.conversions, predictedVisits: g.prediction?.visits ?? null, predictedConversions: g.prediction?.conversions ?? null, bottleneck },
  };
  // 感想の欄を書き忘れていたら、最後に足す
  const body = out.note.body.includes(PLACEHOLDER) ? out.note.body : `${out.note.body}\n\n${PLACEHOLDER}：今日いちばん気になったこと】`;
  const label = modelInfo(plan.model_id).label;
  const card = await statCard(day, content, label);
  const images = [...(card ? [card] : []), ...images0];
  db().prepare(
    `INSERT INTO daily_reports (day, model_id, content, note_title, note_body, images) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(day) DO UPDATE SET model_id = excluded.model_id, content = excluded.content, note_title = excluded.note_title, note_body = excluded.note_body, images = excluded.images, created_at = datetime('now')`,
  ).run(day, plan.model_id, JSON.stringify(content), out.note.title.slice(0, 100), body.slice(0, 4000), JSON.stringify(images));
  logEvent(null, "ai", "daily-report", `今日の日報を書きました（担当 ${label}）: ${content.headline}`);
  return (db().prepare("SELECT id FROM daily_reports WHERE day = ?").get(day) as { id: number }).id;
}

// 毎晩、投稿の時間が終わる22時以降に1回だけ書く
export async function maybeDailyReport() {
  const s = getSettings();
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Tokyo", hour: "numeric", hourCycle: "h23" }).format(new Date()));
  if (!s.dailyReport || s.killSwitch || hour < 22) return;
  const day = jstDay();
  if (!planFor(day) || db().prepare("SELECT 1 FROM daily_reports WHERE day = ?").get(day)) return;
  // 失敗した直後は、1時間あけてから試す
  if (db().prepare("SELECT 1 FROM events WHERE kind = 'diary-error' AND at >= datetime('now', '-1 hours')").get()) return;
  try {
    await createDiary();
  } catch (e) {
    logEvent(null, "system", "diary-error", `今日の日報を書けませんでした: ${(e instanceof Error ? e.message : String(e)).slice(0, 300)}`);
  }
}
