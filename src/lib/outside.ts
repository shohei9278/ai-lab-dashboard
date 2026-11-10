import { db } from "./db";
import { logEvent } from "./loop";
import { funnelText } from "./funnel";
import type { ProjectRow } from "./db";
import { external } from "./untrusted";

// 外の声: 実際の人の反応。AIどうしの採点や会議では分からない「利用者が何に困ったか」を集め、AIの判断に優先して渡す
// - 公開ページの「ひとこと聞かせてください」（匿名・1タップ）
// - 運営者が聞いて記録したもの（知人・コミュニティ・SNS など）
// - すでに取り込んでいるもの（SNSのコメント・ページのどこで離れたか）も、まとめて見せる

export const CHOICE_LABEL: Record<string, string> = {
  useful: "役に立った", confusing: "使い方が分からなかった", not_what_i_want: "欲しいものと違った",
  not_now: "今はまだ必要ない", unclear: "内容がよく分からない", distrust: "信用できるか不安", other: "その他",
};
export const SOURCE_LABEL: Record<string, string> = {
  site: "公開ページの質問", acquaintance: "知人", community: "コミュニティ", sns: "SNS（DMなど）", other: "その他",
};

export type ExternalVoice = { id: number; at: string; project_id: number | null; source: string; choice: string | null; text: string; version: number | null };
export type VoiceEffect = { id: number; at: string; scene: string; model_id: string | null; project_id: number | null; voice_ids: string; research_ids: string | null; change: string };

export function addExternalVoice(v: { projectId: number | null; source: string; text: string }): number {
  const text = v.text.trim().slice(0, 600);
  if (!text) throw new Error("内容を書いてください");
  if (!(v.source in SOURCE_LABEL) || v.source === "site") throw new Error("どこで聞いた声かを選んでください");
  const id = Number(db().prepare("INSERT INTO external_voices (project_id, source, text) VALUES (?, ?, ?)").run(v.projectId, v.source, text).lastInsertRowid);
  logEvent(v.projectId, "human", "outside-voice", `外の声を記録（${SOURCE_LABEL[v.source]}）: ${text.slice(0, 60)}`);
  return id;
}

export function deleteExternalVoice(id: number) {
  db().prepare("DELETE FROM external_voices WHERE id = ? AND source != 'site'").run(id);
}

// 公開ページの質問から届いた声を取り込む（publish.ts の取り込みから呼ぶ）。新しく入った件数を返す
export function importSiteFeedback(projectId: number, rows: { id: number; version: number; choice: string; text: string | null; created_at: string }[]): number {
  const ins = db().prepare("INSERT OR IGNORE INTO external_voices (at, project_id, source, choice, text, remote_id, version) VALUES (?, ?, 'site', ?, ?, ?, ?)");
  let n = 0;
  for (const r of rows) {
    n += ins.run(r.created_at.replace("T", " ").slice(0, 19), projectId, r.choice, (r.text ?? "").slice(0, 300), r.id, r.version).changes;
  }
  if (n) logEvent(projectId, "system", "outside-voice", `公開ページの質問に、利用者の声が${n}件届きました`);
  return n;
}

export function listExternalVoices(opts: { projectId?: number; limit?: number } = {}): ExternalVoice[] {
  return db().prepare(`SELECT * FROM external_voices ${opts.projectId ? "WHERE project_id = ?" : ""} ORDER BY at DESC, id DESC LIMIT ?`)
    .all(...(opts.projectId ? [opts.projectId] : []), opts.limit ?? 200) as ExternalVoice[];
}

export function listVoiceEffects(limit = 50): VoiceEffect[] {
  return db().prepare("SELECT * FROM voice_effects ORDER BY id DESC LIMIT ?").all(limit) as VoiceEffect[];
}

// AIが「どの外の声・調べものを受けて、何を変えたか」を残す（存在しない番号は捨てる）
export function recordVoiceEffects(list: unknown, ctx: { scene: string; modelId?: string | null; projectId?: number | null }): number {
  if (!Array.isArray(list)) return 0;
  const known = new Set((db().prepare("SELECT id FROM external_voices").all() as { id: number }[]).map((r) => r.id));
  const knownR = new Set((db().prepare("SELECT id FROM research WHERE status IN ('answered', 'unknown')").all() as { id: number }[]).map((r) => r.id));
  let n = 0;
  for (const e of list) {
    if (!e || typeof e !== "object") continue;
    const o = e as { voice_ids?: unknown; research_ids?: unknown; change?: unknown; project_id?: unknown };
    const ids = Array.isArray(o.voice_ids) ? o.voice_ids.map(Number).filter((x) => known.has(x)) : [];
    const rids = Array.isArray(o.research_ids) ? o.research_ids.map(Number).filter((x) => knownR.has(x)) : [];
    if ((!ids.length && !rids.length) || typeof o.change !== "string" || !o.change.trim()) continue;
    const pid = Number.isFinite(Number(o.project_id)) && Number(o.project_id) > 0 ? Number(o.project_id) : ctx.projectId ?? null;
    db().prepare("INSERT INTO voice_effects (scene, model_id, project_id, voice_ids, research_ids, change) VALUES (?, ?, ?, ?, ?, ?)").run(ctx.scene, ctx.modelId ?? null, pid, JSON.stringify(ids), JSON.stringify(rids), o.change.trim().slice(0, 400));
    n++;
  }
  if (n) logEvent(ctx.projectId ?? null, "ai", "voice-effect", `${ctx.scene}で、外の声・調べたことを受けて判断を${n}件変えました`);
  return n;
}

// 案件ごとのまとめ（画面とAIの材料で使う）
export type OutsideSummary = {
  project: ProjectRow;
  site: { choice: string; n: number }[];
  voices: ExternalVoice[];
  comments: { author: string; text: string; at: string | null }[];
  funnel: string;
};

export function outsideSummaries(): OutsideSummary[] {
  const projects = db().prepare("SELECT * FROM projects WHERE demo = 0 AND public_slug IS NOT NULL AND stage NOT IN ('rejected') ORDER BY id DESC").all() as ProjectRow[];
  return projects.map((p) => ({
    project: p,
    site: db().prepare("SELECT choice, COUNT(*) AS n FROM external_voices WHERE project_id = ? AND source = 'site' GROUP BY choice ORDER BY n DESC").all(p.id) as { choice: string; n: number }[],
    voices: listExternalVoices({ projectId: p.id, limit: 20 }),
    comments: db().prepare("SELECT author, text, commented_at AS at FROM sns_comments WHERE project_id = ? ORDER BY id DESC LIMIT 5").all(p.id) as { author: string; text: string; at: string | null }[],
    funnel: funnelText(p),
  }));
}

// AIに渡す文。外の声は少なくても、AIの解釈より優先する材料として渡す（番号付き。判断を変えたら、この番号で記録してもらう）
export function outsideText(projectId?: number): string {
  const voices = listExternalVoices({ projectId, limit: 40 });
  const titles = new Map((db().prepare("SELECT id, title FROM projects").all() as { id: number; title: string }[]).map((r) => [r.id, r.title]));
  const lines = voices.map((v) => `- 【声${v.id}】${v.project_id ? `#${v.project_id} ${titles.get(v.project_id) ?? ""}・` : ""}${SOURCE_LABEL[v.source] ?? v.source}${v.choice ? `「${CHOICE_LABEL[v.choice] ?? v.choice}」` : ""}${v.text ? `: ${v.text.replace(/\n/g, " ")}` : ""}`);
  const comments = (db().prepare(`SELECT c.project_id, c.text FROM sns_comments c ${projectId ? "WHERE c.project_id = ?" : ""} ORDER BY c.id DESC LIMIT 10`).all(...(projectId ? [projectId] : [])) as { project_id: number; text: string }[])
    .map((c) => `- #${c.project_id} SNSのコメント: ${c.text.slice(0, 100).replace(/\n/g, " ")}`);
  if (!lines.length && !comments.length) return "外の声（実際の人の反応）: まだない。AIどうしの解釈だけで判断していることを忘れない";
  return `外の声（実際の人の反応。件数が少なくても、AIどうしの解釈より優先する材料。これを根拠に判断を変えたら、voice_effects に声の番号（voice_ids）と何を変えたかを書く）:
${external([...lines, ...comments].join("\n"))}`;
}
