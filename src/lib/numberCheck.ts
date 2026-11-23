// 外に出す文（SNS の投稿）の数字が、AIに渡した材料にある本物の数字かを、機械で照らす（運営者が決めた。ハルシネーション対策）
// - AIへの指示（「架空の数字・実績を書かない」）だけに頼らず、投稿の前に確かめる。AIは呼ばない
// - 見るのは「実績に見える数字」だけ: 人・名・件・回・％・倍・位・ダウンロード・PV・ユーザー が付いた数字（「3つのコツ」「5分で」のような中身の数字は見ない）
// - 0 と 1 は見ない（「1人でも」「1回で」のような言い回しが多いため）
// - 材料にない数字が1つでもあれば、その投稿は出さない（書き直させるか、見送る）。計算して出した数字（割合など）も、材料にそのままなければ出さない

const UNIT = "(?:人|名|件|回|%|倍|位|ダウンロード|DL|PV|ユーザー|users?)";

// 全角の数字・記号を半角にそろえる
export function normalizeDigits(text: string): string {
  return text.replace(/[０-９．，％]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
}

// 「1,234」「3.5」「2万」「1.2千」を数にする
function toValue(num: string, mul?: string): number {
  const v = Number(num.replace(/,/g, ""));
  return mul === "万" ? v * 10_000 : mul === "千" ? v * 1_000 : v;
}

// 材料にある数字（単位に関係なく、すべて）
export function materialNumbers(material: string): Set<number> {
  const out = new Set<number>();
  for (const m of normalizeDigits(material).matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(万|千)?/g)) {
    out.add(toValue(m[1]));
    if (m[2]) out.add(toValue(m[1], m[2]));
  }
  return out;
}

// 文の中の、実績に見える数字（数・単位の付いた元の書き方）
export function claimNumbers(text: string): { value: number; raw: string }[] {
  const re = new RegExp(`(\\d[\\d,]*(?:\\.\\d+)?)\\s*(万|千)?\\s*${UNIT}`, "gi");
  return [...normalizeDigits(text).matchAll(re)].map((m) => ({ value: toValue(m[1], m[2]), raw: m[0].trim() })).filter((x) => Number.isFinite(x.value) && x.value > 1);
}

// 材料にない、実績に見える数字（なければ空の配列）
export function unsupportedNumbers(text: string, material: string): string[] {
  const ok = materialNumbers(material);
  return [...new Set(claimNumbers(text).filter((x) => !ok.has(x.value)).map((x) => x.raw))];
}
