"use client";

import { useEffect, useMemo, useState } from "react";
import type { OfficeSnapshot } from "@/lib/office";
import { MEMBERS, ROOMS, stateAt, toMs, type Member, type OfficeLine, type Room } from "@/lib/officeShared";

// オフィス（試作）の画面。部屋は図形と色だけで描き、社員は丸で表す（動き方の価値を先に確かめるため、絵の作り込みはしない）
// - だれかが3分以内に動いていれば「いま」を映す
// - だれも動いていなければ、直近24時間の動きを早送りで再生する（1つの動きを2.5秒ずつ）

const ROOM_BOX: Record<Room, { left: number; top: number; width: number; height: number; icon: string; bg: string }> = {
  dev: { left: 2, top: 4, width: 47, height: 44, icon: "💻", bg: "color-mix(in srgb, var(--series-google) 10%, var(--surface))" },
  meeting: { left: 51, top: 4, width: 47, height: 44, icon: "🗣️", bg: "color-mix(in srgb, var(--series-anthropic) 10%, var(--surface))" },
  pr: { left: 2, top: 52, width: 47, height: 44, icon: "📣", bg: "color-mix(in srgb, var(--series-openai) 10%, var(--surface))" },
  lounge: { left: 51, top: 52, width: 47, height: 44, icon: "☕", bg: "var(--surface-2)" },
};
const COLOR: Record<Member, string> = { anthropic: "var(--series-anthropic)", openai: "var(--series-openai)", google: "var(--series-google)" };
const STEP_MS = 2500;
const LINE_SECONDS = 120; // 吹き出しを出しておく長さ（その時刻から何秒前までの声を出すか）

const jstHM = (utc: string) => new Date(toMs(utc) + 9 * 3600_000).toISOString().slice(11, 16);
const nowUtc = () => new Date().toISOString().replace("T", " ").slice(0, 19);

export function OfficeView({ initial }: { initial: OfficeSnapshot }) {
  const [snap, setSnap] = useState(initial);
  const [now, setNow] = useState(initial.now);
  const [step, setStep] = useState(0);

  // 10秒ごとに新しい記録を読む
  useEffect(() => {
    const t = setInterval(async () => {
      const r = await fetch("/api/office", { cache: "no-store" }).catch(() => null);
      if (r?.ok) setSnap((await r.json()) as OfficeSnapshot);
    }, 10_000);
    return () => clearInterval(t);
  }, []);

  // 再生する時刻の並び（動きと吹き出しの時刻）。いまだれかが動いているかで、いまを映すか再生するかを決める
  const times = useMemo(() => [...new Set([...snap.events.map((e) => e.at), ...snap.lines.map((l) => l.at)])].sort(), [snap]);
  const liveNow = useMemo(() => Object.values(stateAt(snap.events, nowUtc())).some((s) => s.room !== "lounge"), [snap]);
  useEffect(() => {
    const t = setInterval(() => {
      setNow(nowUtc());
      if (!liveNow && times.length) setStep((i) => (i + 1) % times.length);
    }, liveNow ? 3000 : STEP_MS);
    return () => clearInterval(t);
  }, [liveNow, times]);
  const replaying = !liveNow && times.length > 0;
  const at = replaying ? times[step % times.length] : now;

  const state = stateAt(snap.events, at);
  const t = toMs(at);
  const lineOf = (m: Member): OfficeLine | undefined =>
    [...snap.lines].reverse().find((l) => l.member === m && toMs(l.at) <= t && t - toMs(l.at) <= LINE_SECONDS * 1000);
  const recent = snap.events.filter((e) => toMs(e.at) <= t).slice(-5).reverse();

  // 同じ部屋にいる社員は、横に並べる
  const pos = (m: Member) => {
    const room = state[m].room;
    const box = ROOM_BOX[room];
    const same = MEMBERS.filter((x) => state[x.id].room === room).map((x) => x.id);
    const i = same.indexOf(m);
    const x = box.left + (box.width * (i + 1)) / (same.length + 1);
    // 吹き出しが重ならないよう、1人おきに上下にずらす
    const y = box.top + box.height * (same.length > 1 ? (i % 2 ? 0.86 : 0.42) : 0.55);
    return { left: `${x}%`, top: `${y}%` };
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="rounded-full px-2 py-0.5 text-xs font-medium" style={{ background: liveNow ? "var(--good)" : "var(--surface-2)", color: liveNow ? "#fff" : "var(--text-2)" }}>
          {liveNow ? "● いま" : replaying ? `▶ 直近24時間の再生中（${(step % times.length) + 1}/${times.length}）` : "直近24時間の動きはありません"}
        </span>
        <span className="num text-ink-2">{jstHM(at)}</span>
      </div>

      <div className="card relative aspect-[3/4] w-full overflow-hidden sm:aspect-[16/11]">
        {(Object.keys(ROOM_BOX) as Room[]).map((r) => {
          const b = ROOM_BOX[r];
          return (
            <div key={r} className="absolute rounded-xl border border-line" style={{ left: `${b.left}%`, top: `${b.top}%`, width: `${b.width}%`, height: `${b.height}%`, background: b.bg }}>
              <span className="absolute left-2 top-1.5 text-xs font-bold text-ink-2 sm:text-sm">{b.icon} {ROOMS[r]}</span>
            </div>
          );
        })}
        {MEMBERS.map((m) => {
          const s = state[m.id];
          const line = lineOf(m.id);
          const crowded = MEMBERS.filter((x) => state[x.id].room === s.room).length > 1;
          return (
            <div key={m.id} className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center transition-all duration-1000 ease-in-out" style={pos(m.id)}>
              {(line || s.doing) && (
                <div className={`mb-1 ${crowded ? "line-clamp-1" : "line-clamp-2"} w-max max-w-[6.5rem] rounded-lg border border-line bg-surface px-1.5 py-1 text-[10px] leading-snug shadow sm:max-w-[13rem] sm:px-2 sm:text-xs`}>
                  {line ? (
                    <span style={{ color: line.kind === "proposal" ? "var(--accent)" : undefined }}>{line.text}</span>
                  ) : (
                    <span className="text-ink-2">{s.doing}{s.project ? `（${s.project}）` : ""}</span>
                  )}
                </div>
              )}
              <div className="grid h-9 w-9 place-items-center rounded-full text-sm font-bold text-white shadow sm:h-11 sm:w-11" style={{ background: COLOR[m.id] }} aria-hidden>
                {m.name.slice(0, 1)}
              </div>
              <span className="mt-0.5 text-[10px] font-medium sm:text-xs">{m.name}</span>
            </div>
          );
        })}
      </div>

      <section className="card p-3">
        <h2 className="mb-1 text-sm font-bold">最近の動き</h2>
        {recent.length ? (
          <ul className="space-y-0.5 text-xs">
            {recent.map((e, i) => (
              <li key={`${e.at}-${i}`} className="flex gap-2">
                <span className="num text-muted">{jstHM(e.at)}</span>
                <span style={{ color: COLOR[e.member] }}>{MEMBERS.find((m) => m.id === e.member)?.name}</span>
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
