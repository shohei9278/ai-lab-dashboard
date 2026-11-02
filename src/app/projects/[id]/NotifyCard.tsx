"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// 撤退した案件で、事前登録してくれた人に「開発しないことになった」と伝え、メールアドレスを消す
// 送るのは、あなたのメールから（ここでは宛先と文面を用意するだけ）
export function NotifyCard({ projectId, count, template }: { projectId: number; count: number; template: { subject: string; body: string } }) {
  const router = useRouter();
  const [emails, setEmails] = useState<string[] | null>(null);
  const [subject, setSubject] = useState(template.subject);
  const [body, setBody] = useState(template.body);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function call(action: string) {
    const res = await fetch("/api/loop", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, projectId }) }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    if (!res?.ok) throw new Error(data.error ?? "通信に失敗しました");
    return data;
  }
  const mailto = emails && emails.length <= 50
    ? `mailto:?bcc=${encodeURIComponent(emails.join(","))}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
    : null;

  return (
    <section className="card space-y-3 border-l-4 p-4" style={{ borderLeftColor: "var(--accent)" }}>
      <div>
        <h2 className="font-bold">事前登録してくれた人への連絡（{count}人）</h2>
        <p className="text-xs text-muted">
          撤退したので、登録してくれた人に開発しないことを伝え、メールアドレスを消します（プライバシーポリシーで約束していることです）。
          メールはあなたのメールアプリから、宛先を <b>BCC</b> にして送ってください（ほかの人のアドレスが見えないように）。
        </p>
      </div>
      <label className="block text-xs text-ink-2">件名
        <input value={subject} onChange={(e) => setSubject(e.target.value)} className="mt-1 block w-full rounded-lg border border-line bg-surface px-2 py-1 text-sm" />
      </label>
      <label className="block text-xs text-ink-2">本文
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={9} className="mt-1 block w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm" />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!!busy}
          onClick={async () => {
            setBusy("宛先を取り出しています…");
            setError(null);
            try { setEmails((await call("notify-emails")).emails); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
            setBusy(null);
          }}
          className="rounded-lg border border-line px-3 py-1.5 text-sm"
        >
          宛先を表示する
        </button>
        {emails && (
          <>
            <button type="button" onClick={() => navigator.clipboard.writeText(emails.join(", ")).catch(() => {})} className="rounded-lg border border-line px-3 py-1.5 text-sm">宛先をコピー（BCC用）</button>
            {mailto && <a href={mailto} className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink">メールアプリで開く（BCC入り）</a>}
          </>
        )}
      </div>
      {emails && <textarea readOnly value={emails.join(", ")} rows={2} className="block w-full rounded-lg border border-line bg-surface-2 px-2 py-1 text-xs" aria-label="宛先" />}
      <div className="border-t border-line pt-3">
        <button
          type="button"
          disabled={!!busy}
          onClick={async () => {
            if (!window.confirm(`連絡が済んだので、${count}人のメールアドレスを削除しますか？（元に戻せません）`)) return;
            setBusy("削除しています…");
            setError(null);
            try { await call("notify-done"); router.refresh(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
            setBusy(null);
          }}
          className="rounded-lg px-3 py-1.5 text-sm font-medium"
          style={{ background: "var(--critical)", color: "#fff" }}
        >
          連絡した。メールアドレスを削除する
        </button>
      </div>
      {busy && <p className="text-sm text-ink-2" role="status">{busy}</p>}
      {error && <p className="text-sm" style={{ color: "var(--critical)" }} role="alert">{error}</p>}
    </section>
  );
}
