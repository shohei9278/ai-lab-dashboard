import { headers } from "next/headers";

// 見ている人が、運営者（あなた）か、公開中のデモを見に来た人か
// proxy が、ログインの印（クッキー）を確かめて x-viewer に入れる。来た人は閲覧だけで、操作はサーバー側で止めている
export async function isOwner(): Promise<boolean> {
  return (await headers()).get("x-viewer") === "owner";
}

// デモ表示で伏せるときの文言
export const HIDDEN = "（デモ表示）伏せています";

// 来た人に見せるときの伏せ方: エラーの詳しい中身（内部の情報が入ることがある）と、コメントの相手の言葉
const HIDE_KINDS = new Set(["sns-reply"]);
export function maskEventMessage(kind: string, message: string): string {
  if (kind.includes("error")) return "（デモ表示）エラーの詳しい内容は伏せています";
  if (HIDE_KINDS.has(kind)) return "（デモ表示）SNSのコメントに返信しました（相手と本文は伏せています）";
  return message;
}
export function maskEventsForGuest<T extends { kind: string; message: string }>(rows: T[], owner: boolean): T[] {
  return owner ? rows : rows.map((e) => ({ ...e, message: maskEventMessage(e.kind, e.message) }));
}
// 文の中の @アカウント名 を伏せる
export const maskHandles = (s: string) => s.replace(/@[A-Za-z0-9_.-]+/g, "@***");
