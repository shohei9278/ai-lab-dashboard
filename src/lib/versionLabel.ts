import type { ProjectRow } from "./db";

// 版の呼び方（データベースに触れないので、ブラウザ側の部品からも使える）
// 「公開中」は来た人が今見ている版、「未公開」は作ったがまだ公開していない版

export function versionState(p: Pick<ProjectRow, "lp_version" | "public_version">, version: number): string {
  if (p.public_version === version) return "公開中";
  if (version === p.lp_version) return p.public_version === null ? "未公開" : "未公開・最新";
  return "過去の版";
}

export const versionLabel = (p: Pick<ProjectRow, "lp_version" | "public_version">, version: number) => `第${version}版（${versionState(p, version)}）`;

// 公開中の版と最新の版が違うとき（改善した版が未公開のとき）だけ、見比べる意味がある
export const hasUnpublishedVersion = (p: Pick<ProjectRow, "lp_version" | "public_version">) => p.public_version !== null && p.public_version !== p.lp_version;
