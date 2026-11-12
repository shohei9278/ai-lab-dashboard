"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { OfficeSnapshot } from "@/lib/office";
import { HAPPENING, MEMBERS, ROOMS, stateAt, tallyAt, toMs, type Member, type OfficeLine, type Room } from "@/lib/officeShared";

// オフィス（試作）の画面。絵は図形と色だけで、動きと演出で「いま何をしているか」を見せる
// - 社員は部屋ごとに決まった席に座る（会議室はテーブルを囲む）。部屋を移るときは、廊下を通って歩く
// - 作業中は小さく動き、手が空くと休憩室のソファに戻る
// - 公開・撤退・続けるの出来事は、画面の上に演出を出す
// - だれかが3分以内に動いていれば「いま」を映し、だれも動いていなければ直近24時間を早送りで再生する。再生のバーで好きな時刻に飛べる

type Pt = { x: number; y: number };
const ROOM_BOX: Record<Room, { left: number; top: number; width: number; height: number; icon: string; bg: string }> = {
  dev: { left: 2, top: 4, width: 46, height: 42, icon: "💻", bg: "color-mix(in srgb, var(--series-google) 10%, var(--surface))" },
  meeting: { left: 52, top: 4, width: 46, height: 42, icon: "🗣️", bg: "color-mix(in srgb, var(--series-anthropic) 10%, var(--surface))" },
  pr: { left: 2, top: 54, width: 46, height: 42, icon: "📣", bg: "color-mix(in srgb, var(--series-openai) 10%, var(--surface))" },
  lounge: { left: 52, top: 54, width: 46, height: 42, icon: "☕", bg: "var(--surface-2)" },
};
const ORDER: Member[] = ["anthropic", "openai", "google"];
// 席（％）。社員ごとに決まった席に座る
const SEATS: Record<Room, Pt[]> = {
  dev: [{ x: 11, y: 30 }, { x: 25, y: 30 }, { x: 39, y: 30 }],
  pr: [{ x: 11, y: 80 }, { x: 25, y: 80 }, { x: 39, y: 80 }],
  meeting: [{ x: 61, y: 27 }, { x: 89, y: 27 }, { x: 75, y: 40 }],
  lounge: [{ x: 63, y: 82 }, { x: 75, y: 82 }, { x: 87, y: 82 }],
};
// 部屋の出入り口（廊下の上の点）。左の部屋と右の部屋の間は、真ん中を通る
const DOOR: Record<Room, Pt> = { dev: { x: 25, y: 50 }, pr: { x: 25, y: 50 }, meeting: { x: 75, y: 50 }, lounge: { x: 75, y: 50 } };
const CENTER: Pt = { x: 50, y: 50 };
const LEFT: Room[] = ["dev", "pr"];
const seatOf = (room: Room, m: Member) => SEATS[room][ORDER.indexOf(m)];
function pathBetween(from: Room, to: Room, m: Member): Pt[] {
  if (from === to) return [seatOf(to, m)];
  const cross = LEFT.includes(from) !== LEFT.includes(to);
  return [DOOR[from], ...(cross ? [CENTER] : []), DOOR[to], seatOf(to, m)];
}

const COLOR: Record<Member, string> = { anthropic: "var(--series-anthropic)", openai: "var(--series-openai)", google: "var(--series-google)" };
const WORK_ICON: Record<Room, string> = { dev: "⌨️", meeting: "💬", pr: "📮", lounge: "☕" };
const STEP_MS = 2500;
const HOP_MS = 550; // 廊下の1区間を歩く時間
const LINE_SECONDS = 120; // 吹き出しを出しておく長さ
const HAPPENING_SECONDS = 90; // 出来事の演出を出しておく長さ

const jstHM = (utc: string) => new Date(toMs(utc) + 9 * 3600_000).toISOString().slice(11, 16);
const nowUtc = () => new Date().toISOString().replace("T", " ").slice(0, 19);
const nameOf = (m: Member) => MEMBERS.find((x) => x.id === m)!.name;

const KEYFRAMES = `
@keyframes office-walk { from { transform: translateY(0) } to { transform: translateY(-4px) } }
@keyframes office-work { 0%, 100% { transform: rotate(0) } 25% { transform: rotate(-4deg) } 75% { transform: rotate(4deg) } }
@keyframes office-rest { 0%, 100% { transform: scale(1) } 50% { transform: scale(1.04) } }
@keyframes office-pop { 0% { transform: translateY(8px) scale(.8); opacity: 0 } 12% { transform: translateY(0) scale(1); opacity: 1 } 85% { opacity: 1 } 100% { transform: translateY(-6px); opacity: 0 } }
@keyframes office-burst { from { transform: translateY(0); opacity: 1 } to { transform: translateY(-60px); opacity: 0 } }
`;

export function OfficeView({ initial }: { initial: OfficeSnapshot }) {
  const [snap, setSnap] = useState(initial);
  const [now, setNow] = useState(initial.now);
  const [step, setStep] = useState(0);
  const [paused, setPaused] = useState(false);
  const [selected, setSelected] = useState<Member | null>(null);

  // 10秒ごとに新しい記録を読む
  useEffect(() => {
    const t = setInterval(async () => {
      const r = await fetch("/api/office", { cache: "no-store" }).catch(() => null);
      if (r?.ok) setSnap((await r.json()) as OfficeSnapshot);
    }, 10_000);
    return () => clearInterval(t);
  }, []);

  // 再生する時刻の並び（動き・吹き出し・出来事の時刻）
  const times = useMemo(
    () => [...new Set([...snap.events.map((e) => e.at), ...snap.lines.map((l) => l.at), ...snap.happenings.map((h) => h.at)])].sort(),
    [snap],
  );
  const liveNow = useMemo(() => Object.values(stateAt(snap.events, nowUtc())).some((s) => s.room !== "lounge"), [snap]);
  const replaying = paused || (!liveNow && times.length > 0);
  useEffect(() => {
    const t = setInterval(() => {
      setNow(nowUtc());
      if (!paused && !liveNow && times.length) setStep((i) => (i + 1) % times.length);
    }, liveNow ? 3000 : STEP_MS);
    return () => clearInterval(t);
  }, [liveNow, times, paused]);
  const cur = times.length ? Math.min(step, times.length - 1) : 0;
  const at = replaying && times.length ? times[cur] : now;

  const state = stateAt(snap.events, at);
  const tally = tallyAt(snap.events, at);
  const t = toMs(at);
  const lineOf = (m: Member): OfficeLine | undefined =>
    [...snap.lines].reverse().find((l) => l.member === m && toMs(l.at) <= t && t - toMs(l.at) <= LINE_SECONDS * 1000);
  const happening = [...snap.happenings].reverse().find((h) => toMs(h.at) <= t && t - toMs(h.at) <= HAPPENING_SECONDS * 1000);
  const recent = snap.events.filter((e) => toMs(e.at) <= t).slice(-5).reverse();

  // 歩く: 部屋が変わったら、廊下の点を1つずつたどる
  const [pos, setPos] = useState<Record<Member, Pt>>(() => Object.fromEntries(ORDER.map((m) => [m, seatOf("lounge", m)])) as Record<Member, Pt>);
  const [walking, setWalking] = useState<Record<Member, boolean>>({ anthropic: false, openai: false, google: false });
  const roomRef = useRef<Record<Member, Room>>({ anthropic: "lounge", openai: "lounge", google: "lounge" });
  const timers = useRef<Record<Member, ReturnType<typeof setTimeout>[]>>({ anthropic: [], openai: [], google: [] });
  const rooms = ORDER.map((m) => state[m].room).join(",");
  useEffect(() => {
    const next = rooms.split(",") as Room[];
    const all = timers.current;
    const placed = roomRef.current;
    const moved: Member[] = [];
    ORDER.forEach((m, i) => {
      const to = next[i];
      const from = roomRef.current[m];
      if (from === to) return;
      moved.push(m);
      roomRef.current[m] = to;
      all[m].forEach(clearTimeout);
      const path = pathBetween(from, to, m);
      all[m] = [
        setTimeout(() => setWalking((w) => ({ ...w, [m]: true })), 0),
        ...path.map((p, k) => setTimeout(() => setPos((c) => ({ ...c, [m]: p })), k * HOP_MS)),
        setTimeout(() => setWalking((w) => ({ ...w, [m]: false })), path.length * HOP_MS),
      ];
    });
    // 歩いている途中で次の移動が来たり、画面を離れたりしたときは、歩くのをやめて行き先の席に置く（止まったままにしない）
    return () => {
      for (const m of moved) {
        all[m].forEach(clearTimeout);
        all[m] = [];
        const seat = seatOf(placed[m], m);
        setPos((c) => ({ ...c, [m]: seat }));
        setWalking((w) => ({ ...w, [m]: false }));
      }
    };
  }, [rooms]);

  const sel = selected ? { m: selected, s: state[selected], c: tally[selected], line: lineOf(selected) } : null;

  return (
    <div className="space-y-3">
      <style>{KEYFRAMES}</style>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="rounded-full px-2 py-0.5 text-xs font-medium" style={{ background: !replaying ? "var(--good)" : "var(--surface-2)", color: !replaying ? "#fff" : "var(--text-2)" }}>
          {!replaying ? "● いま" : paused ? "⏸ 一時停止中" : times.length ? "▶ 直近24時間を再生中" : "直近24時間の動きはありません"}
        </span>
        <span className="num text-ink-2">{jstHM(at)}</span>
        <span className="ml-auto text-xs text-muted">社員を押すと、いま何をしているかが出ます</span>
      </div>

      <div className="card relative aspect-[3/4] w-full overflow-hidden sm:aspect-[16/10]">
        {(Object.keys(ROOM_BOX) as Room[]).map((r) => {
          const b = ROOM_BOX[r];
          return (
            <div key={r} className="absolute rounded-xl border border-line" style={{ left: `${b.left}%`, top: `${b.top}%`, width: `${b.width}%`, height: `${b.height}%`, background: b.bg }}>
              <span className="absolute left-2 top-1.5 text-xs font-bold text-ink-2 sm:text-sm">{b.icon} {ROOMS[r]}</span>
            </div>
          );
        })}
        {/* 家具: 開発室と広報デスクの机、会議室のテーブル、休憩室のソファ */}
        {(["dev", "pr"] as Room[]).flatMap((r) =>
          SEATS[r].map((p, i) => <div key={`${r}${i}`} className="absolute h-[3%] w-[10%] -translate-x-1/2 rounded bg-[color:var(--border)]" style={{ left: `${p.x}%`, top: `${p.y + 6}%` }} />),
        )}
        <div className="absolute h-[9%] w-[16%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[color:var(--border)]" style={{ left: "75%", top: "27%" }} />
        <div className="absolute h-[4%] w-[34%] -translate-x-1/2 rounded-lg bg-[color:var(--border)]" style={{ left: "75%", top: "88%" }} />

        {happening && (
          <div key={happening.at} className="pointer-events-none absolute left-1/2 top-[46%] z-20 -translate-x-1/2 -translate-y-1/2 text-center" style={{ animation: "office-pop 4s ease-out forwards" }}>
            <div className="relative">
              {[0, 1, 2, 3, 4].map((i) => (
                <span key={i} className="absolute text-xl" style={{ left: `calc(50% + ${-48 + i * 24}px)`, top: "-12px", animation: `office-burst 1.6s ${i * 0.12}s ease-out forwards` }}>{HAPPENING[happening.kind].icon}</span>
              ))}
              <div className="max-w-[80vw] rounded-full border border-line bg-surface px-3 py-1 text-xs font-bold shadow-lg sm:text-sm">
                {HAPPENING[happening.kind].icon} {happening.title ? `「${happening.title}」` : "案件"}{HAPPENING[happening.kind].label}
              </div>
            </div>
          </div>
        )}

        {MEMBERS.map((m) => {
          const s = state[m.id];
          const line = lineOf(m.id);
          const p = pos[m.id];
          const anim = walking[m.id] ? "office-walk .28s ease-in-out infinite alternate" : s.doing ? "office-work .9s ease-in-out infinite" : "office-rest 3s ease-in-out infinite";
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => setSelected(selected === m.id ? null : m.id)}
              className="absolute z-10 flex -translate-x-1/2 -translate-y-full flex-col items-center"
              style={{ left: `${p.x}%`, top: `${p.y + 5}%`, transition: `left ${HOP_MS}ms linear, top ${HOP_MS}ms linear` }}
              aria-label={`${m.name}: ${s.doing ?? "休憩中"}`}
            >
              {!walking[m.id] && (line || s.doing) && (
                // 吹き出しは、端の席では内側に寄せる（画面の外にはみ出さないように）
                <span className={`absolute bottom-full mb-1 line-clamp-2 w-max max-w-[6.5rem] rounded-lg border border-line bg-surface px-1.5 py-1 text-left text-[10px] leading-snug shadow sm:max-w-[12rem] sm:px-2 sm:text-xs ${p.x < 20 ? "left-0" : p.x > 80 ? "right-0" : "left-1/2 -translate-x-1/2"}`}>
                  {line ? (
                    <span style={{ color: line.kind === "proposal" ? "var(--accent)" : undefined }}>{line.kind === "proposal" ? "❗ " : ""}{line.text}</span>
                  ) : (
                    <span className="text-ink-2">{s.doing}{s.project ? `（${s.project}）` : ""}</span>
                  )}
                </span>
              )}
              <span className="relative">
                <span
                  className="grid h-9 w-9 place-items-center rounded-full text-sm font-bold text-white shadow sm:h-11 sm:w-11"
                  style={{ background: COLOR[m.id], animation: anim, outline: selected === m.id ? "3px solid var(--accent)" : undefined, outlineOffset: 2 }}
                >
                  {m.name.slice(0, 1)}
                </span>
                {!walking[m.id] && <span className="absolute -right-2 -top-1 text-xs sm:text-sm" aria-hidden>{s.doing ? WORK_ICON[s.room] : "☕"}</span>}
              </span>
              <span className="mt-0.5 text-[10px] font-medium sm:text-xs">{m.name}</span>
            </button>
          );
        })}
      </div>

      {times.length > 0 && (
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setPaused(!paused)} className="rounded-lg border border-line px-2 py-1 text-xs" aria-label={paused ? "再生する" : "一時停止する"}>
            {paused ? "▶ 再生" : "⏸ 止める"}
          </button>
          <input
            type="range" min={0} max={times.length - 1} value={cur}
            onChange={(e) => { setStep(Number(e.target.value)); setPaused(true); }}
            className="flex-1" aria-label="再生する時刻"
          />
          <span className="num w-12 text-right text-xs text-muted">{jstHM(times[cur])}</span>
          {paused && liveNow && <button type="button" onClick={() => setPaused(false)} className="rounded-lg bg-accent px-2 py-1 text-xs text-accent-ink">いまに戻る</button>}
        </div>
      )}

      {sel && (
        <section className="card space-y-1 p-3 text-sm" aria-live="polite">
          <div className="flex items-baseline gap-2">
            <b style={{ color: COLOR[sel.m] }}>{nameOf(sel.m)}</b>
            <span className="text-ink-2">{ROOMS[sel.s.room]}</span>
            <button type="button" onClick={() => setSelected(null)} className="ml-auto text-xs text-muted">閉じる</button>
          </div>
          <p>{sel.s.doing && sel.s.since ? `${sel.s.doing}${sel.s.project ? `（${sel.s.project}）` : ""}を ${jstHM(sel.s.since)} から` : "手が空いて、休憩しています"}</p>
          <p className="num text-xs text-ink-2">この日のAIの呼び出し: {sel.c.calls}回・約{Math.round(sel.c.yen)}円</p>
          {sel.line && <p className="text-xs text-ink-2">最近のひとこと: {sel.line.text}</p>}
        </section>
      )}

      <section className="card p-3">
        <h2 className="mb-1 text-sm font-bold">最近の動き</h2>
        {recent.length ? (
          <ul className="space-y-0.5 text-xs">
            {recent.map((e, i) => (
              <li key={`${e.at}-${i}`} className="flex gap-2">
                <span className="num text-muted">{jstHM(e.at)}</span>
                <span style={{ color: COLOR[e.member] }}>{nameOf(e.member)}</span>
                <span className="text-ink-2">{ROOMS[e.room]}で{e.doing}{e.project ? `（${e.project}）` : ""}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted">まだ動きはありません。</p>
        )}
      </section>
    </div>
  );
}
