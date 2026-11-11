// AIのチェック結果に出る項目名を、画面で読める言葉にする（中身のデータは変えない）
const NAMES: [RegExp, string][] = [
  [/\bshareText\b/g, "シェア文"],
  [/\bsubheadline\b/g, "サブ見出し"],
  [/\bheadline\b/g, "見出し"],
  [/\bfeatures\b/g, "特徴の欄"],
  [/\bsteps\b/g, "手順の欄"],
  [/\bbeforeAfter\b/g, "使う前後の比較"],
  [/\bpreview\b/g, "画面イメージ"],
  [/\btool\b/g, "ツール本体"],
];

export const plainIssue = (text: string) => NAMES.reduce((t, [from, to]) => t.replace(from, to), text);
