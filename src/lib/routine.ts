// クラウドの Claude Code（ルーティン）を起動する（提案箱の改善: aiFix.ts、案件のツール: toolRoutine.ts）
// ルーティンはサブスクの使用量で動く。起動の URL とトークンは Railway の変数にだけ置く
// トークンを、決まった送り先（Anthropic のルーティンの起動）以外に送らない

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

const FIRE_URL = /^https:\/\/api\.anthropic\.com\/v1\/claude_code\/routines\/trig_[A-Za-z0-9]+\/fire$/;

// 起動の URL（形を確かめたもの）とトークンが、どちらもあるか
export function routineConfigured(urlVar: string, tokenVar: string): boolean {
  return FIRE_URL.test(process.env[urlVar] ?? "") && !!process.env[tokenVar];
}

// 起動して、作業の画面（claude.ai）の URL を返す（返ってこなければ null）
// 失敗したときは、応答の中身（トークンの手がかりになりうる）を出さず、番号だけ伝える
export async function fireRoutine(urlVar: string, tokenVar: string, text: string, fetchImpl: Fetch = fetch): Promise<string | null> {
  if (!routineConfigured(urlVar, tokenVar)) throw new Error("Claude Code のルーティンがまだつながっていません");
  const res = await fetchImpl(process.env[urlVar]!, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env[tokenVar]}`,
      "anthropic-beta": "experimental-cc-routine-2026-04-01",
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Claude Code のルーティンを起動できませんでした（${res.status}）`);
  const data = (await res.json().catch(() => ({}))) as { claude_code_session_url?: unknown };
  return typeof data.claude_code_session_url === "string" && /^https:\/\/claude\.ai\/[^\s"'<>]+$/.test(data.claude_code_session_url) ? data.claude_code_session_url : null;
}

// 記録の日時（UTC の "YYYY-MM-DD HH:MM:SS"）を、時刻の数にする
export const atMs = (at: string) => Date.parse(`${at.replace(" ", "T")}Z`);
