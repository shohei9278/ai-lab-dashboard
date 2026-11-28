import crypto from "node:crypto";
import { db, type ProjectRow } from "./db";
import { needsOf } from "./needs";
import { toolAiSpecOf, type ToolAiSpec } from "../../lp-site/src/lp/toolAi";

// その場で AI を呼ぶツールの許可（docs/design-tool-limits.md の「共通の作り」と ③）
// - 使ってよい案件: アイデアの「要るもの」に「その場でAIを呼ぶ」があり、人が「済み」にした案件だけ（markNeedsDone。ツールを作る流れからは変えられない）
// - AIへの指示: ツールを入れるときに <script type="application/json" id="lab-ai"> で添えたものを、ツールのコード（HTML のハッシュ）ごとに持つ
// - 承認: 人が公開を承認したときに、そのコードと指示の組み合わせを承認する。コードか指示が変われば、承認し直す（前の承認は引き継がない）
// - 公開: 承認された指示だけを公開サイトに渡す（publish.ts）。全自動の公開・自動改善の差し替えでは承認しない（loop.ts）

const hashOf = (html: string) => crypto.createHash("sha256").update(html).digest("hex");

// この案件のツールは、その場で AI を呼んでよいか（人が「済み」にした、AI が要る案件か）
export function aiAllowed(p: Pick<ProjectRow, "needs" | "needs_done">): boolean {
  if (!p.needs || p.needs_done !== 1) return false;
  try { return needsOf(JSON.parse(p.needs)).some((n) => n.kind === "ai"); } catch { return false; }
}

// 今のツールのコード（なければ null）
export function toolHtmlOf(p: Pick<ProjectRow, "lp">): string | null {
  if (!p.lp) return null;
  try {
    const html = (JSON.parse(p.lp) as { tool?: { html?: unknown } }).tool?.html;
    return typeof html === "string" ? html : null;
  } catch { return null; }
}

// ツールのコードに添えた指示と、承認したか（添えていなければ null）
export function aiSpecFor(projectId: number, html: string): { spec: ToolAiSpec; approved: boolean } | null {
  const r = db().prepare("SELECT spec, approved_at FROM tool_ai_specs WHERE project_id = ? AND html_hash = ?").get(projectId, hashOf(html)) as { spec: string; approved_at: string | null } | undefined;
  if (!r) return null;
  let spec: ToolAiSpec | string;
  try { spec = toolAiSpecOf(JSON.parse(r.spec)); } catch { return null; }
  return typeof spec === "string" ? null : { spec, approved: !!r.approved_at };
}

// 公開サイトに渡す指示（承認したものだけ。なければ undefined）
export function approvedAiSpec(projectId: number, html: string): ToolAiSpec | undefined {
  const s = aiSpecFor(projectId, html);
  return s?.approved ? s.spec : undefined;
}

// まだ承認していない指示が、今のツールに添えてあるか（全自動の公開・自動改善を止める）
export function aiSpecPending(p: Pick<ProjectRow, "id" | "lp">): boolean {
  const html = toolHtmlOf(p);
  const s = html ? aiSpecFor(p.id, html) : null;
  return !!s && !s.approved;
}

// この案件に、承認した指示が1つでもあるか（その場で AI を使うツールとして公開したことがある）
export function aiEverApproved(projectId: number): boolean {
  return !!db().prepare("SELECT 1 FROM tool_ai_specs WHERE project_id = ? AND approved_at IS NOT NULL LIMIT 1").get(projectId);
}

// ツールを入れるときに、そのコードの指示を入れ替える（指示なしで入れ直したら消す）。戻す関数を返す（取り込みが失敗したとき用。playVideo.ts の台本と同じ）
// 同じコードに同じ指示を入れ直したときだけ、前の承認を残す（コードか指示が変われば、承認し直す）
export function replaceAiSpec(projectId: number, html: string, spec: ToolAiSpec | null): () => void {
  const hash = hashOf(html);
  const before = db().prepare("SELECT spec, at, approved_at FROM tool_ai_specs WHERE project_id = ? AND html_hash = ?").get(projectId, hash) as { spec: string; at: string; approved_at: string | null } | undefined;
  if (spec) {
    db().prepare("INSERT INTO tool_ai_specs (project_id, html_hash, spec) VALUES (?, ?, ?) ON CONFLICT(project_id, html_hash) DO UPDATE SET at = datetime('now'), approved_at = CASE WHEN spec = excluded.spec THEN approved_at ELSE NULL END, spec = excluded.spec")
      .run(projectId, hash, JSON.stringify(spec));
  } else db().prepare("DELETE FROM tool_ai_specs WHERE project_id = ? AND html_hash = ?").run(projectId, hash);
  return () => {
    if (before) db().prepare("INSERT INTO tool_ai_specs (project_id, html_hash, spec, at, approved_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(project_id, html_hash) DO UPDATE SET spec = excluded.spec, at = excluded.at, approved_at = excluded.approved_at").run(projectId, hash, before.spec, before.at, before.approved_at);
    else db().prepare("DELETE FROM tool_ai_specs WHERE project_id = ? AND html_hash = ?").run(projectId, hash);
  };
}

// 人が公開を承認したときに、今のツールのコードと指示の組み合わせを承認する。承認したら true
// 使ってよい案件でなくなっていたら（人の作業待ちに戻した など）承認しない
export function approveAiSpec(p: Pick<ProjectRow, "id" | "lp" | "needs" | "needs_done">): boolean {
  const html = toolHtmlOf(p);
  if (!html || !aiAllowed(p)) return false;
  return db().prepare("UPDATE tool_ai_specs SET approved_at = datetime('now') WHERE project_id = ? AND html_hash = ? AND approved_at IS NULL").run(p.id, hashOf(html)).changes > 0;
}
