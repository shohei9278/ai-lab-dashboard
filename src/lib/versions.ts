import { db, type ProjectRow } from "./db";
import { normalizeLp, type Lp } from "../../lp-site/src/lp/content";

// LP・ツールの版を、プレビューや見比べで開くための小さな道具
// 「公開中」は来た人が今見ている版、「未公開」は作ったがまだ公開していない版

export function versionList(projectId: number): number[] {
  return (db().prepare("SELECT version FROM lp_versions WHERE project_id = ? ORDER BY version DESC").all(projectId) as { version: number }[]).map((r) => r.version);
}

// 指定した版の中身。今の版（lp_version）は projects.lp が最新なので、そちらを使う
export function versionLp(p: ProjectRow, version: number): Lp | null {
  if (version === p.lp_version && p.lp) return normalizeLp(JSON.parse(p.lp));
  const row = db().prepare("SELECT lp FROM lp_versions WHERE project_id = ? AND version = ?").get(p.id, version) as { lp: string } | undefined;
  return row ? normalizeLp(JSON.parse(row.lp)) : null;
}

export { hasUnpublishedVersion, versionLabel, versionState } from "./versionLabel";
