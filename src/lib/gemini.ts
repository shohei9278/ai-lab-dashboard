import { GoogleGenAI } from "@google/genai";

// Gemini の呼び出し口。@google/genai 3 から、既定の API の版が v1beta から v1 に変わった。
// v1 には gemini-3.1-pro-preview などの preview 版のモデルがないので、v1beta を明示する
// （2026-11-15 にモデルの一覧で確かめた。v1 は28件、v1beta は64件で、gemini-3.1-pro-preview は v1beta にだけある）
export const GEMINI_API_VERSION = "v1beta";

export function gemini(timeoutMs?: number): GoogleGenAI {
  return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY, apiVersion: GEMINI_API_VERSION, ...(timeoutMs ? { httpOptions: { timeout: timeoutMs } } : {}) });
}
