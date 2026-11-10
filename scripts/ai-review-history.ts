// GPTのレビューで、同じPRの過去の指摘と運営者の判断を渡すためのまとめ（判断済みの指摘を繰り返さないように）
export type PrComment = { body: string; user?: { login?: string; type?: string } | null; author_association?: string };

const MAX_REVIEWS = 6;
const MAX_LENGTH = 12_000;
// 誰でもコメントできる公開リポジトリなので、関係者の判断だけを使う
const TRUSTED = ["OWNER", "MEMBER", "COLLABORATOR"];
export const REVIEW_MARK = "### 別のAI（";

export function reviewHistory(comments: PrComment[]): string {
  const reviews = comments.filter((c) => c.body?.startsWith(REVIEW_MARK)).slice(-MAX_REVIEWS).map((c) => c.body);
  const decisions = comments.filter((c) => !c.body?.startsWith(REVIEW_MARK) && c.user?.type !== "Bot" && TRUSTED.includes(c.author_association ?? "")).map((c) => c.body);
  if (!reviews.length && !decisions.length) return "";
  const parts = [
    reviews.length ? `これまでのレビュー:\n${reviews.join("\n---\n")}` : "",
    decisions.length ? `運営者のコメント:\n${decisions.join("\n---\n")}` : "",
  ].filter(Boolean);
  return parts.join("\n\n").slice(-MAX_LENGTH);
}
