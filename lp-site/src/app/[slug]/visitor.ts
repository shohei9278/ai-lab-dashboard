// ブラウザごとのランダムなID。訪問を重複して数えないためだけに使う（個人を特定する情報ではない）
export function visitorId(): string {
  const key = "lp_visitor_id";
  try {
    const saved = localStorage.getItem(key);
    if (saved) return saved;
    const id = crypto.randomUUID();
    localStorage.setItem(key, id);
    return id;
  } catch {
    return "anonymous";
  }
}

// 運営者のブラウザを数えないための印。URL に ?me=1 を付けて一度開くと付き、?me=0 で外れる
// 印が付いたブラウザは、訪問・ツールの利用・シェア・登録・GA のどれにも数えない
export const EXCLUDE_KEY = "lp_exclude_me";

export function isExcluded(): boolean {
  try {
    const me = new URLSearchParams(location.search).get("me");
    if (me === "1") localStorage.setItem(EXCLUDE_KEY, "1");
    if (me === "0") localStorage.removeItem(EXCLUDE_KEY);
    return localStorage.getItem(EXCLUDE_KEY) === "1";
  } catch {
    return false;
  }
}
