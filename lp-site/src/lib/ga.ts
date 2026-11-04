import { visitorId } from "@/app/[slug]/visitor";

// GA4 にイベントを送る。GAを読み込んでいないときは何もしない
// メールアドレスなど個人を特定できる情報は送らない
// LPのページのイベント（lp_slug が付いたもの）は、自分のデータベースにも記録する（ダッシュボードの「ページの中での動き」用）
type Gtag = (command: "event", name: string, params?: Record<string, string | number>) => void;

// 記録で使う「細かい内容」: どの部分が見えたか・どこまで読んだか・どこでシェアしたか
const DETAIL_KEY: Record<string, string> = { section_view: "section", scroll_depth: "percent", share: "method" };

export function gaEvent(name: string, params?: Record<string, string | number>) {
  try {
    if (localStorage.getItem("lp_exclude_me") === "1") return; // 運営者のブラウザは送らない
  } catch {}
  const gtag = (window as unknown as { gtag?: Gtag }).gtag;
  if (typeof gtag === "function") gtag("event", name, params);
  if (params?.lp_slug) {
    const body = JSON.stringify({
      slug: params.lp_slug, version: params.lp_version, name, visitorId: visitorId(),
      detail: DETAIL_KEY[name] ? String(params[DETAIL_KEY[name]] ?? "") : "",
    });
    // ページを離れる瞬間でも届くように sendBeacon を使う
    const sent = typeof navigator.sendBeacon === "function" && navigator.sendBeacon("/api/lp-event", new Blob([body], { type: "application/json" }));
    if (!sent) fetch("/api/lp-event", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
  }
}
