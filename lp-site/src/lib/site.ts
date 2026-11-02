// 運営者の情報（Vercel の環境変数で設定する）
export const SITE_NAME = process.env.SITE_NAME || "AI Product Lab";
export const CONTACT_EMAIL = process.env.CONTACT_EMAIL || "";
export const POLICY_UPDATED = process.env.POLICY_UPDATED || "2026年11月1日";

// Google アナリティクス4 の測定ID（G-XXXXXXXXXX）。未設定ならGAは読み込まない
const ga = process.env.GA_MEASUREMENT_ID?.trim() ?? "";
export const GA_MEASUREMENT_ID = /^G-[A-Z0-9]{4,20}$/.test(ga) ? ga : "";
