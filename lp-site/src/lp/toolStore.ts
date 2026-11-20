// ツールの記録を、公開ページの側で預かる窓口（window.labStore）（運営者の依頼。#72 で、見つけた景色を日をまたいで残すため）
// - ツールは隔離された枠（allow-same-origin なし）の中で動くので、自分では localStorage などを使えない
//   枠に allow-same-origin を付けると、ツールからこのサイトの Cookie・保存領域に触れられてしまうので付けない
// - 代わりに、枠の中の小さなスクリプト（toolHtml.ts の BRIDGE）が知らせを送り、ページの側（ToolFrame）がツールごとの場所に保存して答える
//   ツールは自分の記録だけを読み書きできる（場所はページが決めるので、ほかのツールの記録は読めない）
// - 公開サイトはブラウザの localStorage に、ダッシュボードのプレビューはその場だけ（メモリ）に残す
// 外部のライブラリを読み込まない（枠の中とページの両方の決まりをここにまとめる）

// 1つのツールが残せる大きさ（JSON にした文字数）
export const TOOL_STORE_MAX = 8000;
export const storeKey = (slug: string) => `lab-store:${slug}`;

export type StoreBackend = { get(key: string): string | null; set(key: string, value: string): void };

export function memoryBackend(): StoreBackend {
  const m = new Map<string, string>();
  return { get: (k) => m.get(k) ?? null, set: (k, v) => { m.set(k, v); } };
}
// ブラウザの保存領域。使えない（プライベートモード・容量いっぱいなど）ときは、何もせず null を返す
export function localBackend(): StoreBackend {
  return {
    get: (k) => { try { return window.localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { window.localStorage.setItem(k, v); } catch { /* 残せなくても遊べる */ } },
  };
}

export type StoreAnswer = { __lab: "store"; id: number; ok: boolean; value?: string | null };

// 枠からの知らせに答える。関係ない知らせなら null
// - store-get: 残した値（JSON の文字列。なければ null）を返す
// - store-set: JSON として読めて TOOL_STORE_MAX 文字までの文字列だけを残す
export function answerStore(data: unknown, key: string, backend: StoreBackend): StoreAnswer | null {
  if (!data || typeof data !== "object") return null;
  const d = data as { __lab?: unknown; id?: unknown; value?: unknown };
  if (d.__lab !== "store-get" && d.__lab !== "store-set") return null;
  const id = typeof d.id === "number" && Number.isFinite(d.id) ? d.id : -1;
  if (d.__lab === "store-get") return { __lab: "store", id, ok: true, value: backend.get(key) };
  if (typeof d.value !== "string" || d.value.length > TOOL_STORE_MAX) return { __lab: "store", id, ok: false };
  try { JSON.parse(d.value); } catch { return { __lab: "store", id, ok: false }; }
  backend.set(key, d.value);
  return { __lab: "store", id, ok: true };
}
