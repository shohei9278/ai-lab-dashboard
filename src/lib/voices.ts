import { db } from "./db";
import { logEvent } from "./loop";
import { modelInfo } from "./models";

// 社員の声と、ふだんの作業の途中で出る提案
// - 声: つぶやき・感想・心配・ダメ出し。決めることはない（気になったものは提案箱へ昇格できる）
// - 提案: 提案箱（plan_requests）に入れる。同じ題は入れない・作業の途中で入る提案は1日5件まで

export type VoiceRow = { id: number; at: string; model_id: string | null; scene: string; project_id: number | null; text: string; request_id: number | null };
export type ProposalSource = "plan" | "meeting" | "scene" | "error" | "revival" | "human" | "voice";
export type NewProposal = {
  title: string; how?: string; why?: string; target: "human" | "system"; source: ProposalSource;
  proposer?: string | null; scene?: string; projectId?: number | null; refId?: number | null; score?: number | null; meetingId?: number | null; planId?: number | null;
};

const CAPPED: ProposalSource[] = ["scene", "error", "revival"];
const SCENE_CAP_PER_DAY = 5;
const norm = (s: string) => s.replace(/[\s「」『』"'、。・!！?？（）()]/g, "").toLowerCase();

// 同じ題が「返事待ち」「見送り」「7日以内にやった」にあれば入れない
function duplicate(title: string): boolean {
  const n = norm(title);
  const rows = db().prepare("SELECT title FROM plan_requests WHERE status = 'open' OR status = 'declined' OR (status = 'done' AND decided_at >= datetime('now', '-7 days'))").all() as { title: string }[];
  return rows.some((r) => norm(r.title) === n);
}

export function addProposal(p: NewProposal): number | null {
  const title = p.title.trim().slice(0, 80);
  if (!title || duplicate(title)) return null;
  if (CAPPED.includes(p.source)) {
    const today = (db().prepare(`SELECT COUNT(*) AS n FROM plan_requests WHERE source IN (${CAPPED.map(() => "?").join(",")}) AND created_at >= datetime('now', '-1 day')`).get(...CAPPED) as { n: number }).n;
    if (today >= SCENE_CAP_PER_DAY) return null;
  }
  const id = Number(db().prepare(
    `INSERT INTO plan_requests (plan_id, title, how, why, source, proposer, target, score, meeting_id, scene, project_id, ref_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(p.planId ?? null, title, (p.how ?? "").slice(0, 600), (p.why ?? "").slice(0, 400), p.source, p.proposer ?? null, p.target, p.score ?? null, p.meetingId ?? null, p.scene ?? null, p.projectId ?? null, p.refId ?? null).lastInsertRowid);
  if (p.source !== "human") logEvent(p.projectId ?? null, p.source === "error" ? "system" : "ai", "proposal", `提案箱に「${title}」が入りました${p.proposer ? `（${modelInfo(p.proposer).label}・${p.scene ?? ""}）` : ""}`);
  return id;
}

// 声を残す（同じ内容が7日以内にあれば残さない）
export function addVoice(v: { modelId?: string | null; scene: string; projectId?: number | null; text: string }): number | null {
  const text = v.text.trim().slice(0, 300);
  if (text.length < 4) return null;
  const recent = db().prepare("SELECT text FROM voices WHERE at >= datetime('now', '-7 days')").all() as { text: string }[];
  if (recent.some((r) => norm(r.text) === norm(text))) return null;
  return Number(db().prepare("INSERT INTO voices (model_id, scene, project_id, text) VALUES (?, ?, ?, ?)").run(v.modelId ?? null, v.scene, v.projectId ?? null, text).lastInsertRowid);
}

export function listVoices(opts: { projectId?: number; limit?: number } = {}): VoiceRow[] {
  return db().prepare(`SELECT * FROM voices ${opts.projectId ? "WHERE project_id = ?" : ""} ORDER BY id DESC LIMIT ?`)
    .all(...(opts.projectId ? [opts.projectId] : []), opts.limit ?? 100) as VoiceRow[];
}

// 気になった声を、提案箱（仕組みの改善）に入れる
export function promoteVoice(id: number): number {
  const v = db().prepare("SELECT * FROM voices WHERE id = ?").get(id) as VoiceRow | undefined;
  if (!v) throw new Error("声が見つかりません");
  if (v.request_id) return v.request_id;
  const rid = addProposal({
    title: v.text.length > 40 ? `${v.text.slice(0, 40)}…` : v.text, how: v.text, why: `社員の声（${v.scene}）から、運営者が提案箱に入れた`,
    target: "system", source: "voice", proposer: v.model_id, scene: v.scene, projectId: v.project_id,
  });
  if (!rid) throw new Error("同じ題の提案が、すでに提案箱にあります");
  db().prepare("UPDATE voices SET request_id = ? WHERE id = ?").run(rid, id);
  return rid;
}

// ---- AIの作業の出力に足す「ひとこと」と「提案」 ----

// 各作業の system の最後に足す説明（出力のJSONに voice と proposal を足してもらう）
export const EXTRAS_RULE = `
あわせて、この会社の社員として、任意で次の2つも出力に足してよい（なければ省く）:
- "voice": 社員としてのひとこと（つぶやき程度、60文字以内）。感想・気づき・心配・ダメ出し・試したいことなど何でもよい（例: 「この題材、刺さる人には刺さりそう」「直す所が多くて、最初の指示が足りない気がする」）。数字や出来事は材料にあるものだけを使い、体験談は作らない
- "proposal": {"title":"短い題","how":"何をどう変えるか","why":"根拠","target":"human（運営者にやってほしいこと）または system（仕組みの改善）"}。この作業を通じて、全体に効きそうな改善に気づいたときだけ`;

type Extras = { voice?: unknown; proposal?: unknown };

// 出力から voice と proposal を取り出して残す（形が崩れていれば無視する）
export function takeExtras(out: unknown, ctx: { modelId?: string | null; scene: string; projectId?: number | null }) {
  if (!out || typeof out !== "object") return;
  const o = out as Extras;
  if (typeof o.voice === "string" && o.voice.trim()) addVoice({ ...ctx, text: o.voice });
  const p = o.proposal as { title?: unknown; how?: unknown; why?: unknown; target?: unknown } | null | undefined;
  if (p && typeof p === "object" && typeof p.title === "string" && p.title.trim()) {
    addProposal({
      title: p.title, how: typeof p.how === "string" ? p.how : "", why: typeof p.why === "string" ? p.why : "",
      target: p.target === "human" ? "human" : "system", source: "scene", proposer: ctx.modelId, scene: ctx.scene, projectId: ctx.projectId,
    });
  }
}

// 同じ種類のエラーが24時間に3回以上起きたら、仕組みの改善として提案箱に入れる（AIは呼ばない。1時間に1回だけ見る）
const gErr = globalThis as unknown as { __aiLabErrCheck?: number };
export function proposeFromErrors() {
  if (gErr.__aiLabErrCheck && Date.now() - gErr.__aiLabErrCheck < 3_600_000) return;
  gErr.__aiLabErrCheck = Date.now();
  const rows = db().prepare(
    `SELECT kind, COUNT(*) AS n, MAX(id) AS last FROM events WHERE kind LIKE '%error%' AND at >= datetime('now', '-1 day') GROUP BY kind HAVING COUNT(*) >= 3`,
  ).all() as { kind: string; n: number; last: number }[];
  for (const r of rows) {
    const msg = (db().prepare("SELECT message, project_id FROM events WHERE id = ?").get(r.last) as { message: string; project_id: number | null });
    addProposal({
      title: `「${r.kind}」のエラーが続いている`, how: `最新のエラー: ${msg.message.slice(0, 300)}`, why: `直近24時間で${r.n}回起きている`,
      target: "system", source: "error", scene: "エラーの見張り", projectId: msg.project_id,
    });
  }
}
