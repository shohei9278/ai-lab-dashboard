"use client";

import { useEffect, useRef, useState } from "react";
import type { LiveSnapshot } from "@/lib/live";

// ライブ（もとは別の画面）: オフィスの横の欄（スマホでは絵の下）のタブに置く。いまAIがやっていること・AIの会話・処理のログを、数秒ごとに読み直して出す
// ロボットの動きと会話を一緒に見られるよう、PCではオフィスと同じ高さの欄の中でスクロールする。スマホでは最新の数件と「もっと見る」
// 数字の帯は、ホームの大きな数字とオフィスの数字に任せて出さない。会話とログは切り替え

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

// オフィスで直近24時間を再生しているときに渡すもの: 再生している時刻と、その時刻までの処理のログ（オフィスが持つ24時間分のAIの呼び出しから作る。
// ライブのログは直近30件しか持たないため）
export type ReplayLog = { key: string; at: string; member: string; head: string; text: string; tail: string };
const norm = (s: string) => s.replace("T", " ").slice(0, 19);
const FRESH_SECONDS = 180; // 再生中、この時刻の直前に出た会話を光らせる長さ
const MOBILE_ITEMS = 3; // スマホで最初に出す数（残りは「もっと見る」）
// スマホで「続きを読む」を付けるか: 4行に収まらなそうなもの（改行ごとに、1行あたりの文字数で何行になるかを数える）
const LINE_CHARS = 22; // スマホ幅で1行に入るおおよその文字数
const clamped = (text: string) => text.split("\n").reduce((n, l) => n + Math.max(1, Math.ceil(l.length / LINE_CHARS)), 0) > 4;

// owner: 運営者のときだけ、指示のボタン（controls）を出す（AIを呼ぶので、来た人には出さない）
// replay: オフィスで再生中のときだけ渡す。会話とログを、その時刻までに合わせる（いまAIがやっていることは「いま」の話なので出さない）
// controls: 運営者の指示のボタン（今すぐ会議・アイデア出し・話題の投稿の検索）。「いまAIがやっていること」の下に出す
export function LivePanel({ initial, owner = false, replay = null, controls }: { initial: LiveSnapshot; owner?: boolean; replay?: { at: string; log: ReplayLog[] } | null; controls?: React.ReactNode }) {
  const [data, setData] = useState(initial);
  // 最初の表示はサーバーの時刻にそろえる（ブラウザの時刻で描くと、サーバーの表示と食い違って警告が出る）。そのあと1秒ごとに進める
  const [now, setNow] = useState(() => Date.parse(initial.now));
  const [online, setOnline] = useState(true);
  const [tab, setTab] = useState<"feed" | "log">("feed");
  const [more, setMore] = useState(false);
  const [opened, setOpened] = useState<Set<string>>(new Set());
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

  const nextTick = data.nextTick ? new Date(data.nextTick).getTime() - now : null;
  const until = (at: string) => !replay || norm(at) <= replay.at;
  // 再生中は、再生している時刻の直前に出た会話を光らせる（いまのときは、新しく届いたものを光らせる）
  const isFresh = (key: string, at: string) =>
    replay ? norm(at) <= replay.at && Date.parse(replay.at.replace(" ", "T") + "Z") - Date.parse(norm(at).replace(" ", "T") + "Z") <= FRESH_SECONDS * 1000 : fresh.has(key);
  const feed = data.feed.filter((f) => until(f.at));
  // ログ: AIの呼び出しと出来事を、時刻の新しい順に混ぜる（再生中のAIの呼び出しは、オフィスの記録から）
  const log = [
    ...(replay
      ? replay.log.map((r) => ({ key: r.key, at: r.at, dot: color(r.member), head: r.head, text: r.text, tail: r.tail, bad: false }))
      : data.calls.map((c) => ({ key: `c${c.id}`, at: c.at, dot: color(c.provider), head: c.model, text: `${c.purpose}${c.project ? `（${c.project}）` : ""}`, tail: c.error ? "失敗" : c.jpy >= 0.5 ? `${Math.round(c.jpy)}円` : "", bad: !!c.error }))),
    ...data.events.filter((e) => until(e.at)).map((e) => ({ key: `e${e.id}`, at: e.at, dot: e.actor === "human" ? "var(--text-2)" : e.kind.includes("error") ? "var(--critical)" : "var(--accent)", head: e.actor === "ai" ? "AI" : e.actor === "human" ? (owner ? "あなた" : "運営者") : "システム", text: `${e.project ? `${e.project}: ` : ""}${e.message}`, tail: "", bad: e.kind.includes("error") })),
  ].sort((a, b) => toDate(b.at).getTime() - toDate(a.at).getTime()).slice(0, 40);
  const busy = data.activities.length > 0 || data.building.length > 0;
  const tabCls = (on: boolean) => `rounded-md px-2.5 py-1 text-xs ${on ? "bg-accent font-bold text-accent-ink" : "text-ink-2 hover:bg-surface-2"}`;

  // スマホでは、絵の下に出るので最新の数件だけ出し、残りは「もっと見る」で開く（PCでは横の欄の中でスクロールする）
  const cut = (i: number) => (i >= MOBILE_ITEMS && !more ? "hidden lg:flex" : "flex");
  const rest = (n: number) => Math.max(0, n - MOBILE_ITEMS);

  return (
    <section aria-label="ライブ" className="space-y-2">
      <style>{`
        @keyframes lab-in { from { opacity: 0; transform: translateY(-6px); background: var(--surface-2); } to { opacity: 1; transform: none; } }
        @keyframes lab-pulse { 0%,100% { opacity: 1 } 50% { opacity: .35 } }
        .lab-in { animation: lab-in .6s ease-out; }
        .lab-pulse { animation: lab-pulse 1.4s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) { .lab-in, .lab-pulse { animation: none; } }
      `}</style>

      {/* 更新のようすと、次に動く時刻 */}
      <div className="space-y-0.5 text-xs text-ink-2">
        <p className="flex items-center gap-1.5">
          <span aria-hidden className="lab-pulse inline-block h-2 w-2 rounded-full" style={{ background: !online ? "var(--critical)" : data.killSwitch ? "var(--warning)" : "var(--good)" }} />
          {replay ? <span>再生中: <b className="num text-ink">{hm(replay.at)}</b> までの会話とログ</span> : !online ? "ダッシュボードにつながりません（サーバーが止まっている可能性）" : data.killSwitch ? "緊急停止中" : `${POLL_MS / 1000}秒ごとに更新中`}
        </p>
        {!replay && (
          <p className="num">
            次の自動の確認まで <b className="text-ink">{nextTick === null ? "—" : clock(nextTick)}</b>・アイデア出しまで <b className="text-ink">{clock(untilJstHour(data.dailyHour, now))}</b>
          </p>
        )}
      </div>

      {/* いまAIがやっていること（動いているときだけ）と、運営者の指示のボタン。再生中は出さない */}
      {!replay && busy && (
        <div className="rounded-lg border p-2" style={{ borderColor: "var(--accent)" }}>
          <div className="text-xs text-muted">いまAIがやっていること</div>
          {data.activities.map((a) => (
            <div key={a.key} className="mt-1.5 space-y-1">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span aria-hidden className="lab-pulse" style={{ color: "var(--accent)" }}>◐</span>
                <span className="text-sm font-medium">{a.title}</span>
                <span className="num text-xs text-muted">{clock(now - a.since)} 経過</span>
              </div>
              <ul className="grid gap-1">
                {Object.entries(a.steps).map(([who, st]) => (
                  <li key={who} className="rounded-lg bg-surface-2 px-2 py-1 text-xs"><b>{who}</b> <span className="text-ink-2">{st}</span></li>
                ))}
              </ul>
            </div>
          ))}
          {data.building.length > 0 && (
            <ul className="mt-1 space-y-1">
              {data.building.map((b) => (
                <li key={b.id} className="text-sm">
                  <span aria-hidden className="lab-pulse mr-1" style={{ color: "var(--accent)" }}>◐</span>
                  <span className="font-medium">{b.title}</span>
                  <span className="text-ink-2"> — AIが{b.what}</span>
                  <span className="num ml-1 text-xs text-muted">{clock(now - b.since)} 経過</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {!replay && owner && controls && <div className="rounded-lg border border-line p-2">{controls}</div>}

      {/* AIの会話とログ（切り替え）。data-demo-ok: 見るだけで何も変えないので、来た人も押せる */}
      <div role="tablist" aria-label="ライブの表示" className="flex gap-1">
        <button type="button" role="tab" data-demo-ok aria-selected={tab === "feed"} onClick={() => setTab("feed")} className={tabCls(tab === "feed")}>AIの会話（{feed.length}）</button>
        <button type="button" role="tab" data-demo-ok aria-selected={tab === "log"} onClick={() => setTab("log")} className={tabCls(tab === "log")}>処理のログ</button>
      </div>
      {tab === "feed" ? (
        <ol className="space-y-1.5" aria-label="AIの会話">
          {feed.map((f, i) => (
            <li key={f.key} className={`${cut(i)} flex-col rounded-lg border-l-4 bg-surface-2 p-2 ${isFresh(f.key, f.at) ? "lab-in" : ""}`} style={isFresh(f.key, f.at) && replay ? { borderLeftColor: color(f.provider), outline: "2px solid var(--accent)", outlineOffset: "-2px" } : { borderLeftColor: color(f.provider) }}>
              <div className="flex flex-wrap items-baseline gap-x-2 text-[11px]">
                <span className="font-bold" style={{ color: f.provider ? color(f.provider) : "var(--text)" }}>{f.who}</span>
                <span className="text-ink-2">{f.kind}</span>
                {f.project && <span className="text-muted">#{f.project}</span>}
                <span className="num ml-auto text-muted" title={hm(f.at)}>{replay ? hm(f.at) : ago(f.at, now)}</span>
              </div>
              {/* スマホでは1件を4行までにして、長いものは「続きを読む」で開く（PCでは全文） */}
              <p className={`mt-0.5 whitespace-pre-wrap text-[13px] leading-relaxed ${opened.has(f.key) ? "" : "line-clamp-4 lg:line-clamp-none"}`}>{f.text}</p>
              {clamped(f.text) && (
                <button type="button" data-demo-ok onClick={() => setOpened((o) => { const n = new Set(o); if (n.has(f.key)) n.delete(f.key); else n.add(f.key); return n; })} className="self-start text-[11px] text-accent underline lg:hidden">
                  {opened.has(f.key) ? "閉じる" : "続きを読む"}
                </button>
              )}
            </li>
          ))}
          {!feed.length && <li className="text-sm text-ink-2">{replay ? "この時刻までの会話はありません（会話は新しいものから60件まで持っています）。" : "まだ会話がありません。毎日のアイデア出しで、AI同士の採点が流れ始めます。"}</li>}
        </ol>
      ) : (
        <ol className="space-y-0.5 text-xs" aria-label="処理のログ">
          {log.map((l, i) => (
            <li key={l.key} className={`${cut(i)} gap-2 rounded px-1 py-1 ${isFresh(l.key, l.at) ? "lab-in" : ""}`}>
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
      )}
      {rest(tab === "feed" ? feed.length : log.length) > 0 && (
        <button type="button" data-demo-ok onClick={() => setMore(!more)} className="w-full rounded-lg border border-line py-1.5 text-xs text-ink-2 lg:hidden">
          {more ? "閉じる" : `もっと見る（残り${rest(tab === "feed" ? feed.length : log.length)}件）`}
        </button>
      )}
    </section>
  );
}
