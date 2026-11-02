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
