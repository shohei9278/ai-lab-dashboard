// GA4 にイベントを送る。GAを読み込んでいないときは何もしない
// メールアドレスなど個人を特定できる情報は送らない
type Gtag = (command: "event", name: string, params?: Record<string, string | number>) => void;

export function gaEvent(name: string, params?: Record<string, string | number>) {
  const gtag = (window as unknown as { gtag?: Gtag }).gtag;
  if (typeof gtag === "function") gtag("event", name, params);
}
