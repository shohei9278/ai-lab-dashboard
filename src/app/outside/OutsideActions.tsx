"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const post = (body: unknown) => fetch("/api/outside", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

// あなたが聞いた声を記録する（知人の感想・コミュニティの反応・DM など）
export function AddOutsideVoice({ projects, defaultProjectId }: { projects: { id: number; title: string }[]; defaultProjectId?: number }) {
  const router = useRouter();
  const [projectId, setProjectId] = useState<number | "">(defaultProjectId ?? "");
  const [source, setSource] = useState("acquaintance");
  const [text, setText] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <form
      className="space-y-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const res = await post({ projectId: projectId || null, source, text });
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) return setMsg(data.error ?? "記録できませんでした");
        setText("");
        setMsg("記録しました。次の朝会・判断・会議でAIが読みます");
        router.refresh();
      }}
    >
      <div className="flex flex-wrap gap-2 text-sm">
        <select value={projectId} onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : "")} className="rounded-lg border border-line bg-surface px-2 py-1">
          <option value="">案件を選ばない（全体について）</option>
          {projects.map((p) => <option key={p.id} value={p.id}>#{p.id} {p.title}</option>)}
        </select>
        <select value={source} onChange={(e) => setSource(e.target.value)} className="rounded-lg border border-line bg-surface px-2 py-1">
          <option value="acquaintance">知人に聞いた</option>
          <option value="community">コミュニティでの反応</option>
          <option value="sns">SNS（DMなど）</option>
          <option value="other">その他</option>
        </select>
      </div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={600} rows={3} required placeholder="例: 使ってみたら、最初に何を入れればいいか分からず止まった。例文があれば続けたかも" className="block w-full rounded-lg border border-line bg-surface px-2 py-1 text-sm" />
      <div className="flex items-center gap-3">
        <button type="submit" className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink">記録する</button>
        {msg && <span className="text-xs text-ink-2">{msg}</span>}
      </div>
      <p className="text-xs text-muted">聞いた言葉をなるべくそのまま書いてください（あなたの解釈は分けて書くと、AIが事実と解釈を混ぜずに読めます）。相手の名前や連絡先は書かないでください。</p>
    </form>
  );
}

export function DeleteOutsideVoice({ id }: { id: number }) {
  const router = useRouter();
  return (
    <button type="button" className="text-xs underline" onClick={async () => { if (!confirm("この声を消しますか？")) return; await post({ deleteId: id }); router.refresh(); }}>
      消す
    </button>
  );
}
