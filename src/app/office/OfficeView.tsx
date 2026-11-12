"use client";

import { Fragment, createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { OfficeSnapshot } from "@/lib/office";
import { HAPPENING, MEMBERS, ROOMS, stateAt, tallyAt, toMs, type Member, type OfficeLine, type Room } from "@/lib/officeShared";
import { ROBOT_CSS, Robot, type RobotMood } from "./Robot";

// オフィス（試作）の画面。斜め上から見た床の上で、ロボット社員（動画と同じ絵）が動いて「いま何をしているか」を見せる
// - 社員は部屋ごとに決まった席に座る（会議室はテーブルを囲む）。部屋を移るときは、廊下を通って歩く
// - 作業中は小さく動き、手が空くと休憩室のソファに戻る
// - 公開・撤退・続けるの出来事は、画面の上に演出を出す
// - だれかが3分以内に動いていれば「いま」を映し、だれも動いていなければ直近24時間を早送りで再生する。再生のバーで好きな時刻に飛べる

type Pt = { x: number; y: number };
const tint = (c: string, p: number) => `color-mix(in srgb, ${c} ${p}%, var(--surface))`;
const ROOM_BOX: Record<Room, { left: number; top: number; width: number; height: number; icon: string; bg: string; edge: string }> = {
  dev: { left: 3, top: 3, width: 44, height: 44, icon: "💻", bg: tint("var(--series-google)", 14), edge: tint("var(--series-google)", 40) },
  meeting: { left: 53, top: 3, width: 44, height: 44, icon: "🗣️", bg: tint("var(--series-anthropic)", 14), edge: tint("var(--series-anthropic)", 40) },
  pr: { left: 3, top: 53, width: 44, height: 44, icon: "📣", bg: tint("var(--series-openai)", 14), edge: tint("var(--series-openai)", 40) },
  lounge: { left: 53, top: 53, width: 44, height: 44, icon: "☕", bg: tint("var(--text)", 6), edge: tint("var(--text)", 22) },
};
// 高さ（px）を、画面の幅に合わせて縮める倍率（PCの幅で1。スマホでは小さくなる。床の広さは％なので、高さだけを合わせる）
const ScaleCtx = createContext(1);
const DESIGN_WIDTH = 1180; // 高さを決めたときの画面の幅

// 斜め上から見た形にする傾き（床）と、その上で立った向きに戻す傾き（ロボット・吹き出し・モニター）
const ISO = "rotateX(60deg) rotateZ(-45deg)";
const UPRIGHT = "rotateZ(45deg) rotateX(-60deg)";

// 床の上の箱（x・y・幅・奥行きは床の％、h は高さ px）。上の面と、手前に見える2つの側面（y の大きい側と x の小さい側）を描く
function Box({ x, y, w, d, h, top, side, side2, round, radius }: { x: number; y: number; w: number; d: number; h: number; top: string; side: string; side2?: string; round?: boolean; radius?: string }) {
  const r = round ? "50%" : radius ?? "6px";
  h = h * useContext(ScaleCtx);
  return (
    <div className="absolute" style={{ left: `${x}%`, top: `${y}%`, width: `${w}%`, height: `${d}%`, transformStyle: "preserve-3d" }}>
      {!round && <div className="absolute left-0 top-full w-full" style={{ height: h, background: side, transformOrigin: "top", transform: "rotateX(90deg)" }} />}
      {!round && <div className="absolute right-full top-0 h-full" style={{ width: h, background: side2 ?? `color-mix(in srgb, ${side} 80%, #000)`, transformOrigin: "right", transform: "rotateY(90deg)" }} />}
      {round && <div className="absolute inset-0" style={{ borderRadius: r, background: side, transform: `translateZ(${h / 2}px)` }} />}
      <div className="absolute inset-0 border border-line" style={{ borderRadius: r, background: top, transform: `translateZ(${h}px)` }} />
    </div>
  );
}

// 奥の2辺に立てる壁（窓つき）。left = 左奥の辺（y = 0）、right = 右奥の辺（x = 100）
const WALL_H = 64;
function Wall({ side }: { side: "left" | "right" }) {
  const wallH = WALL_H * useContext(ScaleCtx);
  const windows = (
    <div className="absolute inset-[14%_6%] flex gap-[4%]" style={{ flexDirection: side === "left" ? "row" : "column" }}>
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="flex-1 rounded-[3px] border border-line" style={{ background: "linear-gradient(160deg, color-mix(in srgb, var(--series-google) 30%, var(--surface)) 0%, var(--surface) 70%)" }} />
      ))}
    </div>
  );
  const wall = "linear-gradient(0deg, color-mix(in srgb, var(--text) 10%, var(--surface)), color-mix(in srgb, var(--text) 4%, var(--surface)))";
  return side === "left" ? (
    <div className="absolute left-0 top-0 w-full border border-line" style={{ height: wallH, background: wall, transformOrigin: "top", transform: "rotateX(90deg)" }}>{windows}</div>
  ) : (
    <div className="absolute left-full top-0 h-full border border-line" style={{ width: wallH, background: wall.replace("0deg", "90deg"), transformOrigin: "left", transform: "rotateY(-90deg)" }}>{windows}</div>
  );
}

// 立てて置く絵文字（観葉植物など）
function Prop({ x, y, z = 12, icon, size = "clamp(16px, 2.6vw, 30px)" }: { x: number; y: number; z?: number; icon: string; size?: string }) {
  return (
    <Bill x={x} y={y} z={z}>
      <span className="block leading-none" style={{ fontSize: size }} aria-hidden>{icon}</span>
    </Bill>
  );
}

// 床の模様（部屋はタイルの目地、廊下は板張り）
const TILE = "repeating-linear-gradient(0deg, transparent 0 22px, color-mix(in srgb, var(--text) 5%, transparent) 22px 23px), repeating-linear-gradient(90deg, transparent 0 22px, color-mix(in srgb, var(--text) 5%, transparent) 22px 23px)";
const BOARDS = "repeating-linear-gradient(90deg, transparent 0 14px, color-mix(in srgb, var(--text) 6%, transparent) 14px 15px)";

// 床の上の点（x・y は床の％、z は高さ px）に、立った向きで置く。下の真ん中がその点に来る
function Bill({ x, y, z, move, children }: { x: number; y: number; z: number; move?: boolean; children: React.ReactNode }) {
  z = z * useContext(ScaleCtx);
  return (
    <div
      className="absolute h-0 w-0"
      style={{ left: `${x}%`, top: `${y}%`, transformStyle: "preserve-3d", transform: `translateZ(${z}px)`, transition: move ? `left ${HOP_MS}ms linear, top ${HOP_MS}ms linear` : undefined }}
    >
      <div className="absolute left-0 top-0 h-0 w-0" style={{ transform: UPRIGHT, transformStyle: "preserve-3d" }}>
        <div className="absolute bottom-0 left-0 -translate-x-1/2">{children}</div>
      </div>
    </div>
  );
}
const ORDER: Member[] = ["anthropic", "openai", "google"];
// 席（％）。社員ごとに決まった席に座る
const SEATS: Record<Room, Pt[]> = {
  dev: [{ x: 9, y: 32 }, { x: 21, y: 32 }, { x: 33, y: 32 }],
  pr: [{ x: 9, y: 82 }, { x: 21, y: 82 }, { x: 33, y: 82 }],
  meeting: [{ x: 63, y: 27 }, { x: 72, y: 35 }, { x: 84, y: 33 }], // テーブルの手前側に並ぶ（奥だと吹き出しが画面の上にはみ出す）
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
@keyframes office-ticker { from { transform: translateX(0) } to { transform: translateX(-50%) } }
.office-ticker:hover > div { animation-play-state: paused }
`;

// 上の帯の1つの数字
function Chip({ label, value, tone, href }: { label: string; value: string; tone?: "good" | "warn" | "muted"; href?: string }) {
  const color = tone === "good" ? "var(--good)" : tone === "warn" ? "var(--accent)" : undefined;
  const body = (
    <>
      <span className="text-[10px] text-muted sm:text-xs">{label}</span>
      <span className="num text-sm font-bold sm:text-base" style={{ color }}>{value}</span>
    </>
  );
  const cls = "flex flex-col rounded-lg border border-line bg-surface px-2 py-1";
  return href ? <a href={href} className={`${cls} hover:bg-surface-2`} style={tone === "warn" ? { borderColor: "var(--accent)" } : undefined}>{body}</a> : <div className={cls}>{body}</div>;
}

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
  // 下の帯に流す最近の動き（社員の作業・提案・出来事）。新しい順に12件
  type Tick = { at: string; text: string; color?: string; strong?: boolean };
  const ticks: Tick[] = [
    ...snap.events.filter((e) => toMs(e.at) <= t).slice(-12).map((e) => ({ at: e.at, text: `${nameOf(e.member)}: ${ROOMS[e.room]}で${e.doing}${e.project ? `（${e.project}）` : ""}`, color: COLOR[e.member] })),
    ...snap.lines.filter((l) => l.kind === "proposal" && toMs(l.at) <= t).map((l) => ({ at: l.at, text: `❗ ${nameOf(l.member)}: ${l.text}`, color: "var(--accent)", strong: true })),
    ...snap.happenings.filter((h) => toMs(h.at) <= t).map((h) => ({ at: h.at, text: `${HAPPENING[h.kind].icon} ${h.title ? `「${h.title}」` : "案件"}${HAPPENING[h.kind].label}`, strong: true })),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 12);
  const working = ORDER.filter((m) => state[m].room !== "lounge").length;
  const n = snap.numbers;
  const yen = (v: number) => `${v.toLocaleString("ja-JP")}円`;

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

  // 画面の幅に合わせて、高さの倍率を決める
  const sceneRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = sceneRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setScale(Math.max(0.35, Math.min(1, e.contentRect.width / DESIGN_WIDTH))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="space-y-3">
      <style>{KEYFRAMES + ROBOT_CSS}</style>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="rounded-full px-2 py-0.5 text-xs font-medium" style={{ background: !replaying ? "var(--good)" : "var(--surface-2)", color: !replaying ? "#fff" : "var(--text-2)" }}>
          {!replaying ? "● いま" : paused ? "⏸ 一時停止中" : times.length ? "▶ 直近24時間を再生中" : "直近24時間の動きはありません"}
        </span>
        <span className="num text-ink-2">{jstHM(at)}</span>
        <span className="ml-auto text-xs text-muted">社員を押すと、いま何をしているかが出ます</span>
      </div>

      <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6 sm:gap-2" aria-label="いまの数字">
        <Chip label={replaying ? "その時刻の稼働" : "稼働・待機"} value={`${working}・${3 - working}`} tone={working ? "good" : "muted"} />
        <Chip label="今日の訪問" value={`${n.visitsToday}人`} />
        <Chip label="今日の登録・利用" value={`${n.convToday}人`} tone={n.convToday ? "good" : undefined} />
        <Chip label="今日のAIの費用" value={yen(n.costTodayJpy)} />
        <Chip label="今月の予算" value={`${Math.round((n.monthJpy / Math.max(1, n.budgetJpy)) * 100)}%`} tone={n.monthJpy > n.budgetJpy * 0.8 ? "warn" : undefined} />
        <Chip label={n.stuck ? `確認待ち（止まっている ${n.stuck}）` : "確認待ち"} value={`${n.waiting}件`} tone={n.waiting ? "warn" : undefined} href="/#waiting" />
      </div>
      <p className="-mt-1 text-[10px] text-muted">数字は、再生中もいまのものです（稼働・待機だけ、再生している時刻のもの）。公開・集客中は{n.live}件。</p>

      <ScaleCtx.Provider value={scale}>
      <div ref={sceneRef} className="card relative aspect-[10/8] w-full overflow-hidden sm:aspect-[16/9]" style={{ background: "linear-gradient(180deg, var(--surface) 0%, var(--surface-2) 100%)" }}>
        {/* 床（斜め上から見た形に傾ける）。部屋・机・ロボットはこの上に置き、ロボットと吹き出しは立った向きに戻す */}
        <div className="absolute left-1/2 top-[57%] aspect-square w-[68%] sm:w-[64%]" style={{ transform: `translate(-50%, -50%) ${ISO}`, transformStyle: "preserve-3d" }}>
          <Box x={0} y={0} w={100} d={100} h={6} top={`${BOARDS}, color-mix(in srgb, #b98a5a 16%, var(--surface-2))`} side="color-mix(in srgb, var(--text) 18%, var(--surface-2))" />
          <Wall side="left" />
          <Wall side="right" />
          {(Object.keys(ROOM_BOX) as Room[]).map((r) => {
            const b = ROOM_BOX[r];
            return <Box key={r} x={b.left} y={b.top} w={b.width} d={b.height} h={12} top={`${TILE}, ${b.bg}`} side={b.edge} />;
          })}
          {/* 家具: 開発室と広報デスクの机とモニター（席の奥＝画面の右上に置く）、会議室のテーブル、休憩室のソファ */}
          {(["dev", "pr"] as Room[]).flatMap((r) =>
            SEATS[r].map((p, i) => {
              const on = ORDER.some((m) => state[m].room === r && ORDER.indexOf(m) === i && !walking[m]);
              return (
                <Fragment key={`${r}${i}`}>
                  <Box x={p.x + 1} y={p.y - 10} w={10} d={6} h={22} top="var(--surface)" side="color-mix(in srgb, var(--text) 25%, var(--surface))" />
                  <Bill x={p.x + 6} y={p.y - 8} z={22}>
                    <span className="block h-[clamp(10px,2.4vw,18px)] w-[clamp(14px,3.4vw,26px)] rounded-[3px] border-2 border-[#2a2f3a]" style={{ background: on ? COLOR[ORDER[i]] : "#3a4150", boxShadow: on ? `0 0 10px ${COLOR[ORDER[i]]}` : undefined }} />
                  </Bill>
                </Fragment>
              );
            }),
          )}
          <Box x={68} y={16} w={14} d={14} h={20} top="var(--surface)" side="color-mix(in srgb, var(--text) 25%, var(--surface))" round />
          <Box x={58} y={88} w={34} d={6} h={18} top="color-mix(in srgb, var(--series-anthropic) 25%, var(--surface))" side="color-mix(in srgb, var(--series-anthropic) 45%, var(--surface))" />
          {/* 開発室: 奥の壁ぎわのサーバーラック（光る点） */}
          {[26, 33].map((x) => (
            <Box key={x} x={x} y={4} w={6} d={5} h={52} top="#2a2f3a" side="repeating-linear-gradient(0deg, #2a2f3a 0 7px, #3d4554 7px 8px), #2a2f3a" side2="#1f232c" />
          ))}
          {[26, 33].map((x) => (
            <Bill key={x} x={x + 3} y={9} z={30}>
              <span className="flex gap-[2px]" aria-hidden>{["#5aa9f0", "#58cfa6", "#f08a2a"].map((c, i) => <i key={i} className="block h-[3px] w-[3px] rounded-full" style={{ background: c, boxShadow: `0 0 4px ${c}`, animation: `rb-blink ${1.4 + i * 0.7}s infinite` }} />)}</span>
            </Bill>
          ))}
          {/* 会議室: 奥のホワイトボードと、テーブルの奥の椅子 */}
          <Bill x={86} y={6} z={12}>
            <span className="block h-[clamp(26px,5vw,48px)] w-[clamp(40px,8vw,78px)] rounded-[3px] border-2 border-[#9aa0aa] bg-white p-[6%]" aria-hidden>
              <span className="block h-[2px] w-[70%] rounded bg-[#5aa9f0]" />
              <span className="mt-[8%] block h-[2px] w-[50%] rounded bg-[#f08a2a]" />
              <span className="mt-[8%] block h-[2px] w-[60%] rounded bg-[#58cfa6]" />
            </span>
          </Bill>
          {[{ x: 66, y: 12 }, { x: 80, y: 12 }].map((c) => (
            <Box key={c.x} x={c.x} y={c.y} w={4} d={4} h={16} top="color-mix(in srgb, var(--series-anthropic) 35%, var(--surface))" side="color-mix(in srgb, var(--series-anthropic) 55%, var(--surface))" radius="3px" />
          ))}
          {/* 広報デスク: 掲示板 */}
          <Bill x={44} y={56} z={12}>
            <span className="grid h-[clamp(22px,4.4vw,42px)] w-[clamp(30px,6vw,56px)] grid-cols-3 gap-[2px] rounded-[3px] border-2 border-[#a8865c] bg-[#d9b98e] p-[3px]" aria-hidden>
              {["#ffd166", "#f7f7f4", "#9be7c4", "#f7f7f4", "#ffadad", "#bde0fe"].map((c, i) => <i key={i} className="block rounded-[1px]" style={{ background: c }} />)}
            </span>
          </Bill>
          {/* 休憩室: ラグ・本棚・コーヒーマシン */}
          <Box x={58} y={60} w={34} d={22} h={13} top="repeating-linear-gradient(90deg, color-mix(in srgb, var(--series-openai) 22%, var(--surface)) 0 10px, color-mix(in srgb, var(--series-openai) 14%, var(--surface)) 10px 20px)" side="color-mix(in srgb, var(--series-openai) 30%, var(--surface))" radius="10px" />
          <Box x={93} y={58} w={4} d={18} h={46} top="#8a6a48" side="#7a5c3d" side2="repeating-linear-gradient(0deg, #6b4f33 0 2px, #e76f51 2px 7px, #2a9d8f 7px 11px, #e9c46a 11px 15px, #264653 15px 19px), #6b4f33" />
          <Box x={86} y={56} w={4} d={4} h={26} top="#3d4554" side="#2a2f3a" />
          <Prop x={88} y={58} z={26} icon="☕" size="clamp(10px, 1.6vw, 16px)" />
          {/* 観葉植物（廊下の端と部屋の角） */}
          <Prop x={3} y={50} z={6} icon="🪴" />
          <Prop x={50} y={97} z={6} icon="🪴" />
          <Prop x={44} y={44} z={12} icon="🌿" />
          <Prop x={93} y={93} z={12} icon="🪴" />
          {(Object.keys(ROOM_BOX) as Room[]).map((r) => (
            <Bill key={r} x={ROOM_BOX[r].left + 4} y={ROOM_BOX[r].top + 6} z={14}>
              <span className="whitespace-nowrap rounded-md bg-surface/90 px-1 py-0.5 text-[9px] font-bold text-ink-2 shadow-sm sm:px-1.5 sm:text-xs">{ROOM_BOX[r].icon} {ROOMS[r]}</span>
            </Bill>
          ))}

          {MEMBERS.map((m) => {
            const s = state[m.id];
            const line = lineOf(m.id);
            const p = pos[m.id];
            // 同じ部屋で同じことをしている社員がほかにいれば、吹き出しは先の1人だけに出す（同じ文が重ならないように）
            const shared = !line && !!s.doing && ORDER.slice(0, ORDER.indexOf(m.id)).some((o) => state[o].room === s.room && state[o].doing === s.doing && !lineOf(o));
            const mood: RobotMood = happening?.kind === "publish" ? "happy" : line?.kind === "proposal" ? "alert" : line ? "talk" : s.doing ? "work" : "rest";
            const anim = walking[m.id] ? "office-walk .28s ease-in-out infinite alternate" : s.doing ? "office-work 1.2s ease-in-out infinite" : "office-rest 3s ease-in-out infinite";
            return (
              <Bill key={m.id} x={p.x} y={p.y} z={12} move>
                <button type="button" onClick={() => setSelected(selected === m.id ? null : m.id)} className="flex flex-col items-center" aria-label={`${m.name}: ${s.doing ?? "休憩中"}`}>
                  {!walking[m.id] && !shared && (line || s.doing) && (
                    <span className="mb-1 line-clamp-2 w-max max-w-[7rem] rounded-lg border border-line bg-surface px-1.5 py-1 text-left text-[10px] leading-snug shadow sm:max-w-[12rem] sm:px-2 sm:text-xs">
                      {line ? (
                        <span style={{ color: line.kind === "proposal" ? "var(--accent)" : undefined }}>{line.kind === "proposal" ? "❗ " : ""}{line.text}</span>
                      ) : (
                        <span className="text-ink-2">{WORK_ICON[s.room]} {s.doing}{s.project ? `（${s.project}）` : ""}</span>
                      )}
                    </span>
                  )}
                  <span className="block" style={{ animation: anim, transformOrigin: "50% 100%", filter: selected === m.id ? `drop-shadow(0 0 6px ${COLOR[m.id]})` : undefined, ["--rb-h" as string]: "clamp(40px, 8vw, 80px)" }}>
                    <Robot member={m.id} mood={mood} />
                  </span>
                  <span className="mt-0.5 rounded bg-surface/80 px-1 text-[10px] font-bold sm:text-xs" style={{ color: COLOR[m.id] }}>{m.name}</span>
                </button>
              </Bill>
            );
          })}
        </div>

        {happening && (
          <div key={happening.at} className="pointer-events-none absolute left-1/2 top-[18%] z-20 -translate-x-1/2 -translate-y-1/2 text-center" style={{ animation: "office-pop 4s ease-out forwards" }}>
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
      </div>
      </ScaleCtx.Provider>

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

      {ticks.length > 0 && (
        <div className="office-ticker card overflow-hidden py-2" aria-label="最近の動き">
          <div className="flex w-max gap-8 whitespace-nowrap px-3 text-xs" style={{ animation: `office-ticker ${Math.max(20, ticks.length * 5)}s linear infinite` }}>
            {[0, 1].map((copy) => ticks.map((k, i) => (
              <span key={`${copy}-${i}`} aria-hidden={copy === 1} className={k.strong ? "font-bold" : undefined}>
                <span className="num mr-1 text-muted">{jstHM(k.at)}</span>
                <span style={{ color: k.color }}>{k.text}</span>
              </span>
            )))}
          </div>
        </div>
      )}
    </div>
  );
}
