// 外に出す文（SNS の投稿）の数字が、AIに渡した材料にある本物の数字かを、機械で照らす（運営者が決めた。ハルシネーション対策）
// - AIへの指示（「架空の数字・実績を書かない」）だけに頼らず、投稿の前に確かめる。AIは呼ばない
// - 見るのは「実績に見える数字」だけ: 人・名・件・回・％・倍・位・ダウンロード・PV・ユーザー が付いた数字（「3つのコツ」「5分で」のような中身の数字は見ない）
// - 0 と 1 だけは見ない（「1人でも」「1回で」のような言い回しが多いため。0.5% のような1未満の数は見る）
// - 材料にない数字が1つでもあれば、その投稿は出さない（書き直させるか、見送る）。計算して出した数字（割合など）も、材料にそのままなければ出さない

const UNIT = "(?:人|名|件|回|%|倍|位|ダウンロード|DL|PV|ユーザー|users?)";

// 全角の数字・記号を半角にそろえる
export function normalizeDigits(text: string): string {
  return text.replace(/[０-９．，％]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
}

// 数の書き方: 「1,234」「3.5」「2万」「1.2千」「1万2千」「1万2000」を1つの数として読む（PR #163 の ai-review の指摘）
const N = "\\d[\\d,]*(?:\\.\\d+)?";
// 万のあとの数は、間を空けずに続くものだけ（「2万 300人」を 20300 と読まない）
const NUM = `(${N})\\s*(?:(万)(?:(${N})(千)?)?|(千))?`;
const num = (s: string) => Number(s.replace(/,/g, ""));

// 正規表現の1件（NUM の5つの組）を数にする。万・千が付いたら、直した値だけを使う
function toValue(m: RegExpMatchArray, at: number): number {
  const [a, man, b, bSen, sen] = [m[at], m[at + 1], m[at + 2], m[at + 3], m[at + 4]];
  if (man) return num(a) * 10_000 + (b ? num(b) * (bSen ? 1_000 : 1) : 0);
  if (sen) return num(a) * 1_000;
  return num(a);
}

// 材料にある数字（単位に関係なく、すべて。万・千が付いたものは直した値だけ。材料に「2万人」があっても「2件」は通さない）
export function materialNumbers(material: string): Set<number> {
  const out = new Set<number>();
  for (const m of normalizeDigits(material).matchAll(new RegExp(NUM, "g"))) out.add(toValue(m, 1));
  return out;
}

// 文の中の、実績に見える数字（数・単位の付いた元の書き方）。0 と 1 だけは見ない
export function claimNumbers(text: string): { value: number; raw: string }[] {
  const re = new RegExp(`${NUM}\\s*${UNIT}`, "gi");
  return [...normalizeDigits(text).matchAll(re)].map((m) => ({ value: toValue(m, 1), raw: m[0].trim() })).filter((x) => Number.isFinite(x.value) && x.value !== 0 && x.value !== 1);
}

// 材料にない、実績に見える数字（なければ空の配列）
export function unsupportedNumbers(text: string, material: string): string[] {
  const ok = materialNumbers(material);
  return [...new Set(claimNumbers(text).filter((x) => !ok.has(x.value)).map((x) => x.raw))];
}
