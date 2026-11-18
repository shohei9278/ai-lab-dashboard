// チェックの指摘から、直すための指示文を作る（サーバーと判断待ちの画面の両方で使う。AIは使わない）
// ツールの案件では、紹介ページの指摘に「紹介ページ: 」を付けて残す（ツールの指摘と分けるため）
// - デザインの確認（画面を撮ってAIが見る）の指摘は「デザイン: 」、紹介ページの文の確認の指摘は「紹介ページ: 」で始まる
// - じっくり案件では、紹介ページの指摘だけなら、ツールは今のままにして紹介ページだけをAIに作り直させる（Claude Code の開発待ちにしない）

const PAGE_ISSUE = /^(?:デザイン|紹介ページ): /;

// 紹介ページの指摘か（ツールの指摘でないか）
export const isPageIssue = (issue: string) => PAGE_ISSUE.test(issue);

// 指摘がすべて紹介ページのものか（1つもなければ false）
export const pageOnlyIssues = (issues: string[]) => issues.length > 0 && issues.every(isPageIssue);

export function fixInstruction(issues: string[], isTool: boolean): string {
  const line = (x: string) => (isTool ? x.replace(/^デザイン: /, "紹介ページ: ") : x.replace(PAGE_ISSUE, ""));
  return `AIのチェックで見つかった次の問題だけを直すこと。それ以外（世界観・見た目・文言・機能）は今のまま残す。\n${issues.map((x, i) => `${i + 1}. ${line(x)}`).join("\n")}`;
}
