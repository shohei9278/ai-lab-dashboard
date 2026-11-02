import { db } from "./db";

// 実験メモ（実験の途中で気づいたこと）。AIの教訓メモ（次のアイデア出しに使う）とは別で、AIへの入力には使わない

export const NOTE_TOPICS = {
  idea: "アイデア出し",
  design: "LPのデザイン",
  tool: "ツール",
  judge: "判断・議論",
  cost: "費用",
  other: "その他",
} as const;
export type NoteTopic = keyof typeof NOTE_TOPICS;

export const NOTE_CERTAINTY = {
  once: { label: "1回見ただけ", note: "偶然の可能性が高い" },
  trend: { label: "何度か見た", note: "傾向がありそう" },
  confirmed: { label: "数字で確かめた", note: "件数がそろって確認できた" },
} as const;
export type NoteCertainty = keyof typeof NOTE_CERTAINTY;

export type NoteRow = {
  id: number;
  at: string;
  updated_at: string;
  author: "ai" | "human";
  topic: NoteTopic;
  certainty: NoteCertainty;
  title: string;
  body: string;
  project_id: number | null;
};

export function listNotes(topic?: string): (NoteRow & { project_title: string | null })[] {
  const where = topic && topic in NOTE_TOPICS ? "WHERE n.topic = ?" : "";
  return db()
    .prepare(`SELECT n.*, p.title AS project_title FROM notes n LEFT JOIN projects p ON p.id = n.project_id ${where} ORDER BY n.at DESC, n.id DESC`)
    .all(...(where ? [topic] : [])) as (NoteRow & { project_title: string | null })[];
}

type NoteInput = { topic: NoteTopic; certainty: NoteCertainty; title: string; body: string; projectId: number | null; author?: "ai" | "human"; at?: string };

// 画面や API から来た値を確かめて整える
export function parseNote(v: Record<string, unknown>): NoteInput {
  const title = typeof v.title === "string" ? v.title.trim().slice(0, 120) : "";
  if (!title) throw new Error("タイトルを入れてください");
  const topic = typeof v.topic === "string" && v.topic in NOTE_TOPICS ? (v.topic as NoteTopic) : "other";
  const certainty = typeof v.certainty === "string" && v.certainty in NOTE_CERTAINTY ? (v.certainty as NoteCertainty) : "once";
  const body = typeof v.body === "string" ? v.body.trim().slice(0, 4000) : "";
  const pid = Number(v.projectId);
  const projectId = Number.isInteger(pid) && pid > 0 && db().prepare("SELECT 1 FROM projects WHERE id = ?").get(pid) ? pid : null;
  return { topic, certainty, title, body, projectId };
}

export function addNote(n: NoteInput): number {
  return Number(
    db()
      .prepare("INSERT INTO notes (author, topic, certainty, title, body, project_id, at, updated_at) VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), datetime('now'))")
      .run(n.author ?? "human", n.topic, n.certainty, n.title, n.body, n.projectId, n.at ?? null).lastInsertRowid,
  );
}

export function updateNote(id: number, n: NoteInput) {
  const r = db()
    .prepare("UPDATE notes SET topic = ?, certainty = ?, title = ?, body = ?, project_id = ?, updated_at = datetime('now') WHERE id = ?")
    .run(n.topic, n.certainty, n.title, n.body, n.projectId, id);
  if (!r.changes) throw new Error("メモが見つかりません");
}

export function deleteNote(id: number) {
  db().prepare("DELETE FROM notes WHERE id = ?").run(id);
}
