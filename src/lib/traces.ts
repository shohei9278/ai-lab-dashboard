import { db } from "./db";

// AIに渡した入力と、返ってきた出力の控え（不具合の原因を調べるため）。運営者だけが見られる
// サーバーの容量を圧迫しないよう、直近200件・7日分だけ残し、長い本文は前後だけ残す
const KEEP_ROWS = 200;
const KEEP_DAYS = 7;
const MAX_FIELD = 60_000;

export type TraceSummary = { id: number; at: string; purpose: string; model_id: string; project_id: number | null; error: string | null; input_chars: number; output_chars: number; title: string | null };
export type TraceRow = TraceSummary & { system: string; input: string; output: string | null };

export const clipText = (s: string): string => s.length <= MAX_FIELD ? s : `${s.slice(0, 40_000)}\n\n…（${(s.length - MAX_FIELD).toLocaleString("en-US")}文字を省略）…\n\n${s.slice(-20_000)}`;

// 期限切れと上限を超えた分を消す（AIが長く止まっていても残らないよう、見るときにも消す）
const prune = () => db().prepare(`DELETE FROM ai_traces WHERE at < datetime('now', '-${KEEP_DAYS} days') OR id <= (SELECT id FROM ai_traces ORDER BY id DESC LIMIT 1 OFFSET ${KEEP_ROWS})`).run();

// 記録の失敗で、AIの処理を止めない
export function saveTrace(t: { purpose: string; modelId: string; projectId?: number | null; system: string; input: string; output?: string | null; error?: string | null }) {
  try {
    const conn = db();
    conn.prepare("INSERT INTO ai_traces (purpose, model_id, project_id, system, input, output, error, input_chars, output_chars) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(t.purpose, t.modelId, t.projectId ?? null, clipText(t.system), clipText(t.input), t.output == null ? null : clipText(t.output), t.error ?? null, t.input.length, t.output?.length ?? 0);
    prune();
  } catch (e) {
    console.error("AIの入出力を保存できませんでした", e);
  }
}

export function listTraces(projectId?: number): TraceSummary[] {
  prune();
  return db().prepare(
    `SELECT t.id, t.at, t.purpose, t.model_id, t.project_id, t.error, t.input_chars, t.output_chars, p.title
     FROM ai_traces t LEFT JOIN projects p ON p.id = t.project_id ${projectId ? "WHERE t.project_id = ?" : ""} ORDER BY t.id DESC LIMIT ${KEEP_ROWS}`,
  ).all(...(projectId ? [projectId] : [])) as TraceSummary[];
}

export function getTrace(id: number): TraceRow | undefined {
  prune();
  return db().prepare("SELECT t.*, p.title FROM ai_traces t LEFT JOIN projects p ON p.id = t.project_id WHERE t.id = ?").get(id) as TraceRow | undefined;
}
