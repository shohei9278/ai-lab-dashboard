import { db, type ApprovalRow, type ProjectRow, type Stage } from "./db";
import { autoWork, toolRoutineView } from "./toolRoutine";

// 案件の一覧と案件の画面で見せる、案件の今の様子（11/28 に運営者が、ステータスが分かりづらいと言った）

// 承認待ちのある案件ごとの、承認待ち（古い順）
export function pendingByProject(): Map<number, ApprovalRow[]> {
  const map = new Map<number, ApprovalRow[]>();
  for (const a of db().prepare("SELECT * FROM approvals WHERE status = 'pending' ORDER BY id").all() as ApprovalRow[]) {
    map.set(a.project_id, [...(map.get(a.project_id) ?? []), a]);
  }
  return map;
}

// 承認待ちから、人の判断が要るのか、AIが自動で進めているのかを決める
// AIの作業: ルーティンに自動で頼む開発待ち（toolRoutine.ts の autoWork）。working は、いまルーティンが作業中（頼んで3時間以内）か
// 人の判断: それ以外の承認待ち（公開・判断・データの確認・自動で頼めない開発待ち など）。1つでもあれば人の判断待ちにする
export type WaitState = { kind: "human" } | { kind: "ai"; working: boolean } | null;
export function waitStateOf(rows: Pick<ApprovalRow, "kind" | "status" | "routine_at" | "routine_tries" | "routine_url">[], now = Date.now()): WaitState {
  if (!rows.length) return null;
  if (rows.some((a) => !autoWork(a, now))) return { kind: "human" };
  return { kind: "ai", working: rows.some((a) => toolRoutineView(a, now).working) };
}

// 見せる段階: 開発待ち（Claude Code で作る・直す）があるのに、まだ「アイデア」の段階の案件は「作成」として見せる
// （開発待ちの間は案件の段階が変わらず、作っている最中の案件が「アイデア」に並んでいた。#79）
export function shownStage(p: Pick<ProjectRow, "stage">, rows: Pick<ApprovalRow, "kind">[]): Stage {
  return p.stage === "idea" && rows.some((a) => a.kind === "dev") ? "lp" : p.stage;
}

// 終わった案件の、公開ページがどうなっているか（継続は公開を続ける。撤退・見送りは、公開サイトの一覧から外して受付を終える。publish.ts）
export function resultNote(p: Pick<ProjectRow, "stage" | "public_slug">): string | null {
  if (p.stage === "continued") return "公開中";
  if (p.stage === "killed") return "公開終了";
  if (p.stage === "rejected") return p.public_slug ? "公開終了" : "公開していない";
  return null;
}
