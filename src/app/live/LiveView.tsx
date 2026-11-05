"use client";

import { useEffect, useRef, useState } from "react";
import type { LiveSnapshot } from "@/lib/live";

const POLL_MS = 3000;

// UTC の "YYYY-MM-DD HH:MM:SS" か ISO を、日本時間の「HH:MM」に
const toDate = (s: string) => new Date(s.includes("T") ? s : s.replace(" ", "T") + "Z");
const hm = (s: string) => toDate(s).toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" });
const ago = (s: string, now: number) => {
  const sec = Math.max(0, Math.round((now - toDate(s).getTime()) / 1000));
  if (sec < 60) return `${sec}秒前`;
  if (sec < 3600) return `${Math.floor(sec / 60)}分前`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}時間前`;
  return `${Math.floor(sec / 86400)}日前`;
};
const clock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}` : `${m}:${String(s % 60).padStart(2, "0")}`;
};
// 次に日本時間の hour 時になるまで
const untilJstHour = (hour: number, now: number) => {
  const jst = new Date(now + 9 * 3_600_000);
  const target = new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate(), hour) - 9 * 3_600_000);
  if (target.getTime() <= now) target.setUTCDate(target.getUTCDate() + 1);
  return target.getTime() - now;
};
const color = (p: string | null) => (p ? `var(--series-${p})` : "var(--muted)");

export function LiveView({ initial }: { initial: LiveSnapshot }) {
  const [data, setData] = useState(initial);
  const [now, setNow] = useState(() => Date.now());
  const [online, setOnline] = useState(true);
  // 新しく増えたものを光らせるため、前回までに見たものを覚えておく
  const seen = useRef(new Set<string>([...initial.feed.map((f) => f.key), ...initial.calls.map((c) => `c${c.id}`), ...initial.events.map((e) => `e${e.id}`)]));
  const [fresh, setFresh] = useState(new Set<string>());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    let stop = false;
    const poll = async () => {
      try {
        const res = await fetch("/api/live", { cache: "no-store" });
        if (!res.ok) throw new Error();
        const next = (await res.json()) as LiveSnapshot;
        if (stop) return;
        const keys = [...next.feed.map((f) => f.key), ...next.calls.map((c) => `c${c.id}`), ...next.events.map((e) => `e${e.id}`)];
        const added = keys.filter((k) => !seen.current.has(k));
        added.forEach((k) => seen.current.add(k));
        if (added.length) {
          setFresh(new Set(added));
          setTimeout(() => setFresh(new Set()), 4000);
        }
        setData(next);
        setOnline(true);
      } catch {
        setOnline(false);
      }
    };
    const p = setInterval(poll, POLL_MS);
    return () => { stop = true; clearInterval(t); clearInterval(p); };
  }, []);

  const n = data.numbers;
  const nextTick = data.nextTick ? new Date(data.nextTick).getTime() - now : null;
  // ログ: AIの呼び出しと出来事を、時刻の新しい順に混ぜる
  const log = [
    ...data.calls.map((c) => ({ key: `c${c.id}`, at: c.at, dot: color(c.provider), head: c.model, text: `${c.purpose}${c.project ? `（${c.project}）` : ""}`, tail: c.error ? "失敗" : c.jpy >= 0.5 ? `${Math.round(c.jpy)}円` : "", bad: !!c.error })),
    ...data.events.map((e) => ({ key: `e${e.id}`, at: e.at, dot: e.actor === "human" ? "var(--text-2)" : e.kind.includes("error") ? "var(--critical)" : "var(--accent)", head: e.actor === "ai" ? "AI" : e.actor === "human" ? "あなた" : "システム", text: `${e.project ? `${e.project}: ` : ""}${e.message}`, tail: "", bad: e.kind.includes("error") })),
  ].sort((a, b) => toDate(b.at).getTime() - toDate(a.at).getTime()).slice(0, 40);

  return (
    <div className="space-y-4">
      <style>{`
        @keyframes lab-in { from { opacity: 0; transform: translateY(-6px); background: var(--surface-2); } to { opacity: 1; transform: none; } }
        @keyframes lab-pulse { 0%,100% { opacity: 1 } 50% { opacity: .35 } }
        .lab-in { animation: lab-in .6s ease-out; }
        .lab-pulse { animation: lab-pulse 1.4s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) { .lab-in, .lab-pulse { animation: none; } }
      `}</style>

      {/* 上の帯: 状態とカウントダウン */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span aria-hidden className="lab-pulse inline-block h-2.5 w-2.5 rounded-full" style={{ background: !online ? "var(--critical)" : data.killSwitch ? "var(--warning)" : "var(--good)" }} />
          <h1 className="text-xl font-bold">ライブ</h1>
          <span className="text-xs text-ink-2">{!online ? "ダッシュボードにつながりません（サーバーが止まっている可能性）" : data.killSwitch ? "緊急停止中" : `${POLL_MS / 1000}秒ごとに更新中`}</span>
        </div>
        <div className="num flex flex-wrap gap-4 text-xs text-ink-2">
          <span>次の自動の確認まで <b className="text-base text-ink">{nextTick === null ? "—" : clock(nextTick)}</b><span className="text-muted">（{data.everyMinutes}分ごと）</span></span>
          <span>毎日のアイデア出しまで <b className="text-ink">{clock(untilJstHour(data.dailyHour, now))}</b></span>
          <span>1日のまとめまで <b className="text-ink">{clock(untilJstHour(data.digestHour, now))}</b></span>
        </div>
      </div>

      {/* いまAIがやっていること */}
      <section className="card p-4" style={data.building.length || data.activities.length ? { borderColor: "var(--accent)" } : undefined}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs text-muted">いまAIがやっていること</div>
          <PracticeButton busy={data.activities.length > 0} />
        </div>
        {data.activities.map((a) => (
          <div key={a.key} className="mt-2 space-y-1">
            <div className="flex flex-wrap items-baseline gap-2">
              <span aria-hidden className="lab-pulse" style={{ color: "var(--accent)" }}>◐</span>
              <span className="font-medium">{a.title}</span>
              <span className="num text-xs text-muted">{clock(now - a.since)} 経過</span>
            </div>
            <ul className="grid gap-1 sm:grid-cols-3">
              {Object.entries(a.steps).map(([who, st]) => (
                <li key={who} className="rounded-lg bg-surface-2 px-2 py-1 text-xs">
                  <b>{who}</b>
                  <span className="block text-ink-2">{st}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {data.building.length ? (
          <ul className="mt-1 space-y-1">
            {data.building.map((b) => (
              <li key={b.id} className="flex flex-wrap items-baseline gap-2">
                <span aria-hidden className="lab-pulse" style={{ color: "var(--accent)" }}>◐</span>
                <span className="font-medium">{b.title}</span>
                <span className="text-sm text-ink-2">— AIが{b.what}</span>
                <span className="num text-xs text-muted">{clock(now - b.since)} 経過</span>
              </li>
            ))}
          </ul>
        ) : data.activities.length ? null : (
          <p className="mt-1 text-sm text-ink-2">待機中。次の自動の確認か、毎日のアイデア出しで動き出します。</p>
        )}
      </section>

      {/* 動く数字 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Counter label="今日の訪問" value={n.visitsToday} unit="人" sub={`累計 ${n.visitsTotal}人`} />
        <Counter label="今日の登録・利用" value={n.convToday} unit="人" sub={`累計 ${n.convTotal}人`} />
        <Counter label="今日のSNS投稿" value={n.postsToday} unit="件" sub={`集客中の案件 ${n.live}件`} />
        <Counter label="今日のAIの呼び出し" value={n.callsToday} unit="回" />
        <Counter label="今日のAIの費用" value={n.costTodayJpy} unit="円" />
        <Counter label="今月のAIの費用" value={n.costMonthJpy} unit="円" />
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        {/* AIの会話 */}
        <section className="card p-4 lg:col-span-3">
          <h2 className="mb-2 font-bold">AIの会話</h2>
          <ol className="max-h-[70vh] space-y-2 overflow-y-auto pr-1">
            {data.feed.map((f) => (
              <li key={f.key} className={`rounded-xl border-l-4 bg-surface-2 p-3 ${fresh.has(f.key) ? "lab-in" : ""}`} style={{ borderLeftColor: color(f.provider) }}>
                <div className="flex flex-wrap items-baseline gap-x-2 text-xs">
                  <span className="font-bold" style={{ color: f.provider ? color(f.provider) : "var(--text)" }}>{f.who}</span>
                  <span className="text-ink-2">{f.kind}</span>
                  {f.project && <span className="text-muted">#{f.project}</span>}
                  <span className="num ml-auto text-muted" title={hm(f.at)}>{ago(f.at, now)}</span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm">{f.text}</p>
              </li>
            ))}
            {!data.feed.length && <li className="text-sm text-ink-2">まだ会話がありません。毎日のアイデア出しで、AI同士の採点が流れ始めます。</li>}
          </ol>
        </section>

        {/* ログ */}
        <section className="card p-4 lg:col-span-2">
          <h2 className="mb-2 font-bold">ログ</h2>
          <ol className="max-h-[70vh] space-y-1 overflow-y-auto pr-1 text-xs">
            {log.map((l) => (
              <li key={l.key} className={`flex gap-2 rounded px-1 py-1 ${fresh.has(l.key) ? "lab-in" : ""}`}>
                <span className="num w-10 shrink-0 text-muted">{hm(l.at)}</span>
                <span aria-hidden className="mt-1 inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: l.dot }} />
                <span className="min-w-0 flex-1">
                  <b className="mr-1">{l.head}</b>
                  <span className="text-ink-2" style={l.bad ? { color: "var(--critical)" } : undefined}>{l.text}</span>
                </span>
                {l.tail && <span className="num shrink-0 text-ink-2">{l.tail}</span>}
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}

// 値が変わったら、前の値から数え上げて、少し光らせる
function Counter({ label, value, unit, sub }: { label: string; value: number; unit: string; sub?: string }) {
  const [shown, setShown] = useState(value);
  const [flash, setFlash] = useState(false);
  const from = useRef(value);
  useEffect(() => {
    if (value === from.current) return;
    const start = from.current;
    const t0 = performance.now();
    setFlash(true);
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 800);
      setShown(Math.round(start + (value - start) * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(step);
      else { from.current = value; setTimeout(() => setFlash(false), 600); }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return (
    <div className="card p-3 transition-colors" style={flash ? { borderColor: "var(--accent)" } : undefined}>
      <div className="text-xs text-muted">{label}</div>
      <div className="num mt-1 text-2xl font-bold" style={flash ? { color: "var(--accent)" } : undefined}>
        {shown.toLocaleString("ja-JP")}<span className="ml-0.5 text-sm font-normal text-ink-2">{unit}</span>
      </div>
      {sub && <div className="text-xs text-ink-2">{sub}</div>}
    </div>
  );
}

// 3社にアイデアを出させて、採点するところまでを見る（案件にはしない）
function PracticeButton({ busy }: { busy: boolean }) {
  const [sent, setSent] = useState(false);
  useEffect(() => { if (!busy) setSent(false); }, [busy]);
  return (
    <button
      type="button"
      disabled={busy || sent}
      title="3社のAIがアイデアを1件ずつ出し、作者を伏せてお互いに採点します。案件にはせず、AIの成績にも数えません（約30円）"
      className="rounded-lg border border-line px-3 py-1 text-xs disabled:opacity-50"
      onClick={async () => {
        setSent(true);
        await fetch("/api/live", { method: "POST" }).catch(() => null);
      }}
    >
      {busy || sent ? "アイデア出しの最中です…" : "アイデア出しを見る（案件にはしない・約30円）"}
    </button>
  );
}
