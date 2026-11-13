"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

// 今すぐ会議: 議題と出席者を決めて、AIの社員に会議をしてもらう
export function MeetingForm({ members, running }: { members: { id: string; label: string; color: string }[]; running: string | null }) {
  const router = useRouter();
  const [topic, setTopic] = useState("");
  const [picked, setPicked] = useState(members.map((m) => m.id));
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (running) {
    return (
      <p className="text-sm">
        いま「{running}」の会議をしています（1〜3分ほど）。<Link href="/#live" className="text-accent underline">ホームのライブで様子を見る</Link>
      </p>
    );
  }
  return (
    <form
      className="space-y-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setMsg(null);
        const res = await fetch("/api/meetings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ topic, members: picked }) });
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setBusy(false);
        if (!res.ok) return setMsg(data.error ?? "開けませんでした");
        setTopic("");
        router.refresh();
      }}
    >
      <textarea
        value={topic}
        onChange={(e) => setTopic(e.target.value)}
        maxLength={300}
        rows={2}
        required
        placeholder="議題（例: #42 はまだ続けるべき？ / 集客の方法を増やすなら何から？ / 今週の計画は投稿に偏りすぎていない？）"
        className="block w-full rounded-lg border border-line bg-surface px-2 py-1 text-sm"
      />
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-xs text-muted">出席:</span>
        {members.map((m) => (
          <label key={m.id} className="inline-flex items-center gap-1">
            <input type="checkbox" checked={picked.includes(m.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, m.id] : picked.filter((x) => x !== m.id))} />
            <span style={{ color: m.color }}>{m.label}</span>
          </label>
        ))}
        <button type="submit" disabled={busy || picked.length < 2} className="ml-auto rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink disabled:opacity-50">
          {busy ? "始めています…" : "今すぐ会議を開く（約30〜60円）"}
        </button>
      </div>
      {msg && <p className="text-xs" style={{ color: "var(--critical)" }}>{msg}</p>}
    </form>
  );
}
