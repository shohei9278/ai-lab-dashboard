// 本番で来た人の画面で、ツールの中で起きたエラー（種類と行の番号だけ。toolHtml.ts の ERROR_CATCH が知らせる）
// 記録の「細かい内容」は "TypeError.L123" の形（行の番号が分からないときは L0）。文は個人の入力を含むことがあるので送らない

const DETAIL = /^([A-Za-z]{1,20})\.L(\d{1,6})$/;

export function toolErrorDetail(name: unknown, line: unknown): string | null {
  const n = String(name ?? "").replace(/[^A-Za-z]/g, "").slice(0, 20);
  const l = Math.floor(Number(line));
  if (!n || !Number.isFinite(l) || l < 0 || l > 999_999) return null;
  return `${n}.L${l}`;
}

export function parseToolError(detail: string): { name: string; line: number | null } | null {
  const m = DETAIL.exec(detail);
  if (!m) return null;
  const line = Number(m[2]);
  return { name: m[1], line: line > 0 ? line : null };
}
