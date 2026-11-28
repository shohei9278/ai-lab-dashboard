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

// この案件で、人がAIへの指示を承認したことがあるか（その場で AI を使うツールとして公開したことがある）
// 指示の表は、指示を入れ直すと承認の印が消えるので、案件の印（ai_approved_ever）で見る（PR #240 の ai-review の指摘）
export function aiEverApproved(projectId: number): boolean {
  return !!(db().prepare("SELECT ai_approved_ever FROM projects WHERE id = ?").get(projectId) as { ai_approved_ever: number } | undefined)?.ai_approved_ever;
}

// コードと指示の組み合わせの印。運営者がカードで見たものと、承認するときの今のものが同じかを確かめる（views.ts・loop.ts の decide）
export const aiDigest = (html: string, spec: ToolAiSpec): string =>
  crypto.createHash("sha256").update(`${hashOf(html)}\n${JSON.stringify([spec.instruction, spec.inputMax, spec.outputMax])}`).digest("hex");

// 今のツールのコードと、それに添えた指示の組み合わせの印（指示がなければ null）
export function currentAiDigest(p: Pick<ProjectRow, "id" | "lp">): string | null {
  const html = toolHtmlOf(p);
  const s = html ? aiSpecFor(p.id, html) : null;
  return html && s ? aiDigest(html, s.spec) : null;
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
  const mine = bumpRev(projectId, hash);
  return () => {
    // 戻すのは、ここで書いたあとに誰も書き換えていない（入れ直し・消す・承認をしていない）ときだけ
    // 内容では見分けられない（同じ指示を書いた別の取り込み・そのあとの承認）ので、書くたびに進める番号で見る（PR #240 の ai-review の指摘）
    if (revOf(projectId, hash) !== mine) return;
    if (before) db().prepare("INSERT INTO tool_ai_specs (project_id, html_hash, spec, at, approved_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(project_id, html_hash) DO UPDATE SET spec = excluded.spec, at = excluded.at, approved_at = excluded.approved_at").run(projectId, hash, before.spec, before.at, before.approved_at);
    else db().prepare("DELETE FROM tool_ai_specs WHERE project_id = ? AND html_hash = ?").run(projectId, hash);
    bumpRev(projectId, hash);
  };
}

// 指示を書き換えた回数の番号（コードごと。指示の行を消しても残るよう、別の表に持つ）
function bumpRev(projectId: number, hash: string): number {
  db().prepare("INSERT INTO tool_ai_spec_revs (project_id, html_hash, rev) VALUES (?, ?, 1) ON CONFLICT(project_id, html_hash) DO UPDATE SET rev = rev + 1").run(projectId, hash);
  return revOf(projectId, hash);
}
const revOf = (projectId: number, hash: string): number =>
  (db().prepare("SELECT rev FROM tool_ai_spec_revs WHERE project_id = ? AND html_hash = ?").get(projectId, hash) as { rev: number } | undefined)?.rev ?? 0;

// 人が公開を承認したときに、今のツールのコードと指示の組み合わせを承認する。承認したら true
// digest: 運営者がカードで見た組み合わせの印。今のものと違えば承認しない。使ってよい案件でなくなっていたら（人の作業待ちに戻した など）も承認しない
export function approveAiSpec(p: Pick<ProjectRow, "id" | "lp" | "needs" | "needs_done">, digest: string): boolean {
  const html = toolHtmlOf(p);
  if (!html || !aiAllowed(p) || currentAiDigest(p) !== digest) return false;
  const ok = db().prepare("UPDATE tool_ai_specs SET approved_at = datetime('now') WHERE project_id = ? AND html_hash = ? AND approved_at IS NULL").run(p.id, hashOf(html)).changes > 0;
  if (ok) {
    db().prepare("UPDATE projects SET ai_approved_ever = 1 WHERE id = ?").run(p.id);
    bumpRev(p.id, hashOf(html));
  }
  return ok;
}
