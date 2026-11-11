// GPTのレビューで、差分から外すファイル（機械が作るロックファイル）と、そのことの伝え方
// 外したことを伝えないと、package.json だけが変わって見えて「ロックファイルが更新されていない」と誤って指摘する

export const OMITTED = ["package-lock.json", "lp-site/package-lock.json"];

// git diff --numstat の行（追加 削除 パス）から、外したファイルの説明を作る
export function omittedNote(numstat: string): string {
  const rows = numstat.split("\n").map((l) => l.trim().split(/\s+/)).filter((r) => r.length >= 3 && OMITTED.includes(r[2]));
  if (!rows.length) return "";
  return `差分から省いたファイル（機械が作るため本文は渡していないが、このPRで更新されている）:\n${rows.map(([a, d, p]) => `- ${p}（+${a} −${d}行）`).join("\n")}\nこれらが差分にないことを理由に「更新されていない」とは指摘しないこと。`;
}
