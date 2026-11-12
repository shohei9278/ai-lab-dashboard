"use client";

import Link from "next/link";
import { Fragment, createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { OfficeSnapshot } from "@/lib/office";
import { HAPPENING, MEMBERS, ROOMS, stateAt, tallyAt, toMs, type Member, type MemberState, type OfficeLine, type OfficeShop, type Room } from "@/lib/officeShared";
import { ROBOT_CSS, Robot, type RobotMood } from "./Robot";

// オフィス（試作）の画面。斜め上から見た床の上で、ロボット社員（動画と同じ絵）が動いて「いま何をしているか」を見せる
// - 社員は部屋ごとに決まった席に座る（会議室はテーブルを囲む）。部屋を移るときは、廊下を通って歩く
// - 作業中は小さく動き、手が空くと休憩室のソファに戻る
// - 公開・撤退・続けるの出来事は、画面の上に演出を出す
// - だれかが3分以内に動いていれば「いま」を映す。だれも動いていなければ、確認が必要なもののお知らせだけを出し、直近24時間の動きはボタンで再生する
// - 部屋・家具・店を押すと、その機能の画面に移る（メニューはそのまま残す）

type Pt = { x: number; y: number };
const tint = (c: string, p: number) => `color-mix(in srgb, ${c} ${p}%, var(--surface))`;
// 部屋。押すと、その部屋に合う機能の画面に移る（go はその説明）
const ROOM_BOX: Record<Room, { left: number; top: number; width: number; height: number; icon: string; bg: string; edge: string; href: string; go: string }> = {
  dev: { left: 3, top: 3, width: 44, height: 44, icon: "💻", bg: tint("var(--series-google)", 20), edge: tint("var(--series-google)", 50), href: "/projects", go: "案件の一覧を見る" },
  meeting: { left: 53, top: 3, width: 44, height: 44, icon: "🗣️", bg: tint("var(--series-anthropic)", 20), edge: tint("var(--series-anthropic)", 50), href: "/meetings", go: "会議の記録を見る" },
  pr: { left: 3, top: 53, width: 44, height: 44, icon: "📣", bg: tint("var(--series-openai)", 20), edge: tint("var(--series-openai)", 50), href: "/growth", go: "集客と投稿を見る" },
  lounge: { left: 53, top: 53, width: 44, height: 44, icon: "☕", bg: tint("var(--text)", 8), edge: tint("var(--text)", 28), href: "/diary", go: "日報と社員の声を見る" },
};
// 高さ（px）を、画面の幅に合わせて縮める倍率（PCの幅で1。スマホでは小さくなる。床の広さは％なので、高さだけを合わせる）
const ScaleCtx = createContext(1);
const DESIGN_WIDTH = 1180; // 高さを決めたときの画面の幅

// 斜め上から見た形にする傾き（床）と、その上で立った向きに戻す傾き（ロボット・吹き出し・モニター）
const ISO = "rotateX(60deg) rotateZ(-45deg)";
const UPRIGHT = "rotateZ(45deg) rotateX(-60deg)";

// 床の上の箱（x・y・幅・奥行きは床の％、h は高さ px）。上の面と、手前に見える2つの側面（y の大きい側と x の小さい側）を描く
function Box({ x, y, w, d, h, top, side, side2, round, radius, href, label }: { x: number; y: number; w: number; d: number; h: number; top: string; side: string; side2?: string; round?: boolean; radius?: string; href?: string; label?: string }) {
  const r = round ? "50%" : radius ?? "6px";
  h = h * useContext(ScaleCtx);
  return (
    // リンクでない箱（机・テーブル・ラグなど）は押す操作を通して、下の部屋の床（リンク）に届くようにする
    <div className="absolute" style={{ left: `${x}%`, top: `${y}%`, width: `${w}%`, height: `${d}%`, transformStyle: "preserve-3d", pointerEvents: href ? undefined : "none" }}>
      {!round && <div className="absolute left-0 top-full w-full" style={{ height: h, background: side, transformOrigin: "top", transform: "rotateX(90deg)" }} />}
      {!round && <div className="absolute right-full top-0 h-full" style={{ width: h, background: side2 ?? `color-mix(in srgb, ${side} 80%, #000)`, transformOrigin: "right", transform: "rotateY(90deg)" }} />}
      {round && <div className="absolute inset-0" style={{ borderRadius: r, background: side, transform: `translateZ(${h / 2}px)` }} />}
      {href ? (
        <a href={href} aria-label={label} title={label} className="office-hot absolute inset-0 block border border-line" style={{ borderRadius: r, background: top, transform: `translateZ(${h}px)`, pointerEvents: "auto" }} />
      ) : (
        <div className="absolute inset-0 border border-line" style={{ borderRadius: r, background: top, transform: `translateZ(${h}px)` }} />
      )}
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
    <div className="pointer-events-none absolute left-0 top-0 w-full border border-line" style={{ height: wallH, background: wall, transformOrigin: "top", transform: "rotateX(90deg)" }}>{windows}</div>
  ) : (
    <div className="pointer-events-none absolute left-full top-0 h-full border border-line" style={{ width: wallH, background: wall.replace("0deg", "90deg"), transformOrigin: "left", transform: "rotateY(-90deg)" }}>{windows}</div>
  );
}

// 立てて置く絵文字（観葉植物など）
function Prop({ x, y, z = 12, icon, size = "clamp(16px, 2.6vw, 30px)" }: { x: number; y: number; z?: number; icon: string; size?: string }) {
  return (
    <Bill x={x} y={y} z={z}>
      <span className="pointer-events-none block leading-none" style={{ fontSize: size }} aria-hidden>{icon}</span>
    </Bill>
  );
}

// 立てて置く物を、機能の画面へのリンクにする（押せることが分かるよう、光って説明が出る）
function Hot({ href, label, children }: { href: string; label: string; children: React.ReactNode }) {
  return (
    <a href={href} aria-label={label} title={label} className="office-hot group relative block rounded-md">
      {children}
      <span className="pointer-events-none absolute bottom-full left-1/2 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-[color:var(--text)] px-1.5 py-0.5 text-[10px] text-[color:var(--bg)] group-hover:block group-focus-visible:block">{label}</span>
    </a>
  );
}

// 床の模様（部屋はタイルの目地、廊下は板張り）
const TILE = "repeating-linear-gradient(0deg, transparent 0 22px, color-mix(in srgb, var(--text) 5%, transparent) 22px 23px), repeating-linear-gradient(90deg, transparent 0 22px, color-mix(in srgb, var(--text) 5%, transparent) 22px 23px)";
const BOARDS = "repeating-linear-gradient(90deg, transparent 0 14px, color-mix(in srgb, var(--text) 6%, transparent) 14px 15px)";

// 案件通りの店（オフィスの手前の通りに並ぶ）。今日訪問があれば明かりがつき、撤退した店はシャッターを閉める。社員が作業中の店は、その社員の色で光る
const SHOP_ICON: Record<OfficeShop["kind"], string> = { lp: "✉️", tool: "🛠️" };
const SHOP_STATUS: Record<OfficeShop["status"], string> = { open: "", growing: "🌱", hold: "💤", closed: "🔒" };
function Shop({ shop, x, workers, hot }: { shop: OfficeShop; x: number; workers: Member[]; hot?: boolean }) {
  const lit = shop.visitsToday > 0;
  const closed = shop.status === "closed";
  const glow = workers[0] ? COLOR[workers[0]] : hot ? "var(--accent)" : null;
  const front = closed
    ? "repeating-linear-gradient(180deg, #8a9099 0 3px, #6f757e 3px 6px)"
    : lit
      ? "linear-gradient(180deg, transparent 0 30%, #ffe08a 30% 85%, transparent 85%), color-mix(in srgb, var(--text) 12%, var(--surface))"
      : "linear-gradient(180deg, transparent 0 30%, color-mix(in srgb, var(--text) 30%, var(--surface)) 30% 85%, transparent 85%), color-mix(in srgb, var(--text) 12%, var(--surface))";
  const roof = shop.status === "growing" ? tint("var(--series-openai)", 35) : shop.status === "hold" || closed ? tint("var(--text)", 20) : tint("var(--series-anthropic)", 30);
  return (
    <>
      <Box x={x} y={104} w={10} d={8} h={30} top={roof} side={front} side2="color-mix(in srgb, var(--text) 22%, var(--surface))" />
      <Bill x={x + 5} y={108} z={34}>
        {/* 看板は小さく（種類・状態・今日の訪問）。社員が作業中の店だけ、名前と作業中の社員を出す */}
        <a
          href={`/projects/${shop.id}`}
          className="office-hot block w-max rounded-full border bg-surface px-1.5 py-0.5 text-center text-[9px] leading-tight shadow-sm sm:text-[11px]"
          style={{ borderColor: glow ?? "var(--border)", boxShadow: glow ? `0 0 10px ${glow}` : undefined, opacity: closed ? 0.6 : 1 }}
          title={`${shop.title}（今日の訪問 ${shop.visitsToday}人）`}
          aria-label={`${shop.title}（今日の訪問 ${shop.visitsToday}人）`}
        >
          {(workers.length > 0 || hot) && <span className="block max-w-[8rem] truncate font-bold">{shop.title}</span>}
          <span className="num block whitespace-nowrap">{SHOP_ICON[shop.kind]}{SHOP_STATUS[shop.status]} {closed ? "終了" : `👤${shop.visitsToday}${shop.convToday ? ` ✓${shop.convToday}` : ""}`}</span>
          {workers.length > 0 && <span className="block font-bold" style={{ color: glow ?? undefined }}>{workers.map((m) => MEMBERS.find((x) => x.id === m)!.name).join("・")}が作業中</span>}
        </a>
      </Bill>
    </>
  );
}

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
.office-hot { cursor: pointer; transition: filter .15s, box-shadow .15s }
.office-hot:hover, .office-hot:focus-visible { filter: brightness(1.08) saturate(1.25); outline: 2px solid var(--accent); outline-offset: 2px }
@media (prefers-reduced-motion: reduce) { .office-scene *, .office-ticker > div { animation: none !important; transition: none !important } }
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

// 横の一覧の1人分（スマホでは絵の下に出る）。乗せると、絵の中のその社員が光る
function MemberRow({ member, s, c, line, walking, onHot }: { member: Member; s: MemberState; c: { calls: number; yen: number }; line?: OfficeLine; walking: boolean; onHot: (k: string | null) => void }) {
  return (
    <div className="flex gap-2 border-t border-line pt-2 first-of-type:border-0 first-of-type:pt-0" onMouseEnter={() => onHot(`m:${member}`)} onMouseLeave={() => onHot(null)}>
      <span className="shrink-0" style={{ ["--rb-h" as string]: "40px" }}>
        <Robot member={member} mood={line?.kind === "proposal" ? "alert" : line ? "talk" : s.doing ? "work" : "rest"} />
      </span>
      <div className="min-w-0 space-y-0.5 text-xs">
        <p><b style={{ color: COLOR[member] }}>{nameOf(member)}</b> <span className="text-muted">{walking ? "移動中" : ROOMS[s.room]}</span></p>
        <p className="text-ink-2">{s.doing && s.since ? `${s.doing}${s.project ? `（${s.project}）` : ""}・${jstHM(s.since)}から` : "休憩中"}</p>
        <p className="num text-muted">この日 {c.calls}回・約{Math.round(c.yen)}円</p>
      </div>
    </div>
  );
}

// owner: 運営者かどうか（お知らせの言い方を変える）/ numbers: 上の数字の帯を出すか（ホームの中では、上に同じ数字があるので出さない）
export function OfficeView({ initial, owner = false, numbers = true }: { initial: OfficeSnapshot; owner?: boolean; numbers?: boolean }) {
  const [snap, setSnap] = useState(initial);
  const [now, setNow] = useState(initial.now);
  const [step, setStep] = useState(0);
  const [replayOn, setReplayOn] = useState(false);
  const [paused, setPaused] = useState(false);
  const [selected, setSelected] = useState<Member | null>(null);
  const [hot, setHot] = useState<string | null>(null);

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
  // 再生は、押したときだけ（だれも動いていないときに勝手に過去を流すと、いまと過去が混ざるため）。最後まで再生したら、いまに戻る
  const replaying = replayOn && times.length > 0;
  useEffect(() => {
    const t = setInterval(() => {
      setNow(nowUtc());
      if (replayOn && !paused && times.length) {
        setStep((i) => {
          if (i + 1 >= times.length) {
            setReplayOn(false);
            return 0;
          }
          return i + 1;
        });
      }
    }, replayOn ? STEP_MS : 3000);
    return () => clearInterval(t);
  }, [replayOn, times, paused]);
  const startReplay = () => {
    setStep(0);
    setPaused(false);
    setReplayOn(true);
  };
  const idle = !replaying && !liveNow;
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
    // data-demo-ok: このボタン（社員を押す・再生する）は見るだけで何も変えないので、来訪者にも押せるようにする（GuestGuard の対象外）
    <div className="space-y-3" data-demo-ok>
      <style>{KEYFRAMES + ROBOT_CSS}</style>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="rounded-full px-2 py-0.5 text-xs font-medium" style={{ background: !replaying && liveNow ? "var(--good)" : "var(--surface-2)", color: !replaying && liveNow ? "#fff" : "var(--text-2)" }}>
          {!replaying ? (liveNow ? "● いま（作業中）" : "● いま（全員休憩中）") : paused ? "⏸ 一時停止中（直近24時間）" : "▶ 直近24時間を再生中"}
        </span>
        <span className="num text-ink-2">{jstHM(at)}</span>
        <span className="ml-auto text-xs text-muted">部屋・家具・店を押すと、その機能の画面に移ります</span>
      </div>

      {numbers && (<>
      <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6 sm:gap-2" aria-label="いまの数字">
        <Chip label={replaying ? "その時刻の稼働" : "稼働・待機"} value={`${working}・${3 - working}`} tone={working ? "good" : "muted"} />
        <Chip label="今日の訪問" value={`${n.visitsToday}人`} />
        <Chip label="今日の登録・利用" value={`${n.convToday}人`} tone={n.convToday ? "good" : undefined} />
        <Chip label="今日のAIの費用" value={yen(n.costTodayJpy)} />
        <Chip label="今月の予算" value={`${Math.round((n.monthJpy / Math.max(1, n.budgetJpy)) * 100)}%`} tone={n.monthJpy > n.budgetJpy * 0.8 ? "warn" : undefined} />
        <Chip label={n.stuck ? `確認待ち（止まっている ${n.stuck}）` : "確認待ち"} value={`${n.waiting}件`} tone={n.waiting ? "warn" : undefined} href="/#waiting" />
      </div>
      <p className="-mt-1 text-[10px] text-muted">数字は、再生中もいまのものです（稼働・待機だけ、再生している時刻のもの）。公開・集客中は{n.live}件。</p>
      </>)}

      {/* だれも動いていないとき: いまの状態・次の予定・確認が必要なもの。過去の動きはボタンで再生する（絵には重ねない） */}
      {idle && (
        <div className="card flex flex-wrap items-center gap-x-4 gap-y-1.5 p-2.5 text-xs sm:text-sm" role="status">
          <p className="font-bold">☕ いまは全員休憩中です</p>
          <p className="text-ink-2">{n.killSwitch ? "緊急停止中のため、AIは動きません" : n.dailyHour !== null ? `次の自動実行は毎日${n.dailyHour}時ごろ（朝の計画のあと、予定の時刻に投稿や判断をします）` : "毎日の自動実行はオフです"}</p>
          {(n.approvals > 0 || n.proposals > 0 || n.waiting > 0) && (
            <ul className="flex flex-wrap gap-x-3 gap-y-0.5">
              {n.approvals > 0 && <li><a href="/approvals" className="text-accent underline">判断待ち {n.approvals}件</a>{owner ? "：確認してください" : "（運営者の確認待ち）"}</li>}
              {n.proposals > 0 && <li><a href="/proposals" className="text-accent underline">提案箱の返事待ち {n.proposals}件</a>{owner ? "：提案があるので確認してください" : ""}</li>}
              {n.waiting > 0 && <li><Link href="/#waiting" className="text-accent underline">{owner ? "あなた" : "運営者"}の確認・対応 {n.waiting}件</Link>{n.stuck ? `（止まっている ${n.stuck}件）` : ""}</li>}
            </ul>
          )}
          {times.length > 0 && (
            <button type="button" data-demo-ok onClick={startReplay} className="ml-auto rounded-lg bg-accent px-3 py-1 text-xs font-medium text-accent-ink">▶ 直近24時間の動きを見る（{times.length}件）</button>
          )}
        </div>
      )}

      <ScaleCtx.Provider value={scale}>
      <div className="gap-3 lg:grid lg:grid-cols-[1fr_15rem]">
      <div ref={sceneRef} className="office-scene card relative aspect-[4/3] w-full overflow-hidden sm:aspect-[16/10]" style={{ background: "linear-gradient(180deg, var(--surface) 0%, var(--surface-2) 100%)" }}>
        {/* 床（斜め上から見た形に傾ける）。部屋・机・ロボットはこの上に置き、ロボットと吹き出しは立った向きに戻す */}
        <div className="absolute left-[52%] top-[47%] aspect-square w-[64%] sm:left-[46%] sm:top-[45%] sm:w-[60%]" style={{ transform: `translate(-50%, -50%) ${ISO}`, transformStyle: "preserve-3d" }}>
          <Box x={0} y={0} w={100} d={100} h={6} top={`${BOARDS}, color-mix(in srgb, #b98a5a 16%, var(--surface-2))`} side="color-mix(in srgb, var(--text) 18%, var(--surface-2))" />
          <Wall side="left" />
          <Wall side="right" />
          {(Object.keys(ROOM_BOX) as Room[]).map((r) => {
            const b = ROOM_BOX[r];
            return <Box key={r} x={b.left} y={b.top} w={b.width} d={b.height} h={12} top={`${TILE}, ${b.bg}`} side={b.edge} href={b.href} label={`${ROOMS[r]}: ${b.go}`} />;
          })}
          {/* 家具: 開発室と広報デスクの机とモニター（席の奥＝画面の右上に置く）、会議室のテーブル、休憩室のソファ */}
          {(["dev", "pr"] as Room[]).flatMap((r) =>
            SEATS[r].map((p, i) => {
              const on = ORDER.some((m) => state[m].room === r && ORDER.indexOf(m) === i && !walking[m]);
              return (
                <Fragment key={`${r}${i}`}>
                  <Box x={p.x + 1} y={p.y - 10} w={10} d={6} h={22} top="var(--surface)" side="color-mix(in srgb, var(--text) 25%, var(--surface))" />
                  <Bill x={p.x + 6} y={p.y - 8} z={22}>
                    <span className="pointer-events-none block h-[clamp(10px,2.4vw,18px)] w-[clamp(14px,3.4vw,26px)] rounded-[3px] border-2 border-[#2a2f3a]" style={{ background: on ? COLOR[ORDER[i]] : "#3a4150", boxShadow: on ? `0 0 10px ${COLOR[ORDER[i]]}` : undefined }} />
                  </Bill>
                </Fragment>
              );
            }),
          )}
          <Box x={68} y={16} w={14} d={14} h={20} top="var(--surface)" side="color-mix(in srgb, var(--text) 25%, var(--surface))" round />
          <Box x={58} y={88} w={34} d={6} h={18} top="color-mix(in srgb, var(--series-anthropic) 25%, var(--surface))" side="color-mix(in srgb, var(--series-anthropic) 45%, var(--surface))" />
          {/* 開発室: 奥の壁ぎわのサーバーラック（光る点） */}
          {[26, 33].map((x) => (
            <Box key={x} x={x} y={4} w={6} d={5} h={52} top="#2a2f3a" side="repeating-linear-gradient(0deg, #2a2f3a 0 7px, #3d4554 7px 8px), #2a2f3a" side2="#1f232c" href="/lab" label="サーバー: AIの成績を見る" />
          ))}
          {[26, 33].map((x) => (
            <Bill key={x} x={x + 3} y={9} z={30}>
              <span className="pointer-events-none flex gap-[2px]" aria-hidden>{["#5aa9f0", "#58cfa6", "#f08a2a"].map((c, i) => <i key={i} className="block h-[3px] w-[3px] rounded-full" style={{ background: c, boxShadow: `0 0 4px ${c}`, animation: `rb-blink ${1.4 + i * 0.7}s infinite` }} />)}</span>
            </Bill>
          ))}
          {/* 会議室: 奥のホワイトボードと、テーブルの奥の椅子 */}
          <Bill x={86} y={6} z={12}>
            <Hot href="/plan" label="ホワイトボード: 毎日の計画を見る">
              <span className="block h-[clamp(26px,5vw,48px)] w-[clamp(40px,8vw,78px)] rounded-[3px] border-2 border-[#9aa0aa] bg-white p-[6%]" aria-hidden>
                <span className="block h-[2px] w-[70%] rounded bg-[#5aa9f0]" />
                <span className="mt-[8%] block h-[2px] w-[50%] rounded bg-[#f08a2a]" />
                <span className="mt-[8%] block h-[2px] w-[60%] rounded bg-[#58cfa6]" />
              </span>
            </Hot>
          </Bill>
          {[{ x: 66, y: 12 }, { x: 80, y: 12 }].map((c) => (
            <Box key={c.x} x={c.x} y={c.y} w={4} d={4} h={16} top="color-mix(in srgb, var(--series-anthropic) 35%, var(--surface))" side="color-mix(in srgb, var(--series-anthropic) 55%, var(--surface))" radius="3px" />
          ))}
          {/* 広報デスク: 掲示板 */}
          <Bill x={44} y={56} z={12}>
            <Hot href="/proposals" label={`掲示板: 提案箱を見る${n.proposals ? `（返事待ち ${n.proposals}件）` : ""}`}>
              <span className="grid h-[clamp(22px,4.4vw,42px)] w-[clamp(30px,6vw,56px)] grid-cols-3 gap-[2px] rounded-[3px] border-2 border-[#a8865c] bg-[#d9b98e] p-[3px]" aria-hidden>
                {["#ffd166", "#f7f7f4", "#9be7c4", "#f7f7f4", "#ffadad", "#bde0fe"].map((c, i) => <i key={i} className="block rounded-[1px]" style={{ background: c }} />)}
              </span>
              {n.proposals > 0 && <span className="num absolute -right-2 -top-2 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[9px] font-bold text-accent-ink">{n.proposals}</span>}
            </Hot>
          </Bill>
          {/* 休憩室: ラグ・本棚・コーヒーマシン */}
          <Box x={58} y={60} w={34} d={22} h={13} top="repeating-linear-gradient(90deg, color-mix(in srgb, var(--series-openai) 22%, var(--surface)) 0 10px, color-mix(in srgb, var(--series-openai) 14%, var(--surface)) 10px 20px)" side="color-mix(in srgb, var(--series-openai) 30%, var(--surface))" radius="10px" />
          <Box x={93} y={58} w={4} d={18} h={46} top="#8a6a48" side="#7a5c3d" side2="repeating-linear-gradient(0deg, #6b4f33 0 2px, #e76f51 2px 7px, #2a9d8f 7px 11px, #e9c46a 11px 15px, #264653 15px 19px), #6b4f33" href="/notes" label="本棚: 資料と教訓を見る" />
          <Box x={86} y={56} w={4} d={4} h={26} top="#3d4554" side="#2a2f3a" href="/live" label="コーヒーマシン: ライブ（AIの処理の記録）を見る" />
          <Prop x={88} y={58} z={26} icon="☕" size="clamp(10px, 1.6vw, 16px)" />
          {/* 観葉植物（廊下の端と部屋の角） */}
          <Prop x={3} y={50} z={6} icon="🪴" />
          <Prop x={50} y={97} z={6} icon="🪴" />
          <Prop x={44} y={44} z={12} icon="🌿" />
          <Prop x={93} y={93} z={12} icon="🪴" />
          {/* 案件通り（オフィスの手前の通り）と、案件の店 */}
          <Box x={0} y={101} w={100} d={16} h={3} top="linear-gradient(180deg, color-mix(in srgb, var(--text) 8%, var(--surface-2)) 0 70%, color-mix(in srgb, var(--text) 16%, var(--surface-2)) 70%)" side="color-mix(in srgb, var(--text) 25%, var(--surface-2))" />
          <Bill x={-2} y={110} z={8}>
            <span className="whitespace-nowrap rounded-md bg-surface/90 px-1 py-0.5 text-[9px] font-bold text-ink-2 shadow-sm sm:px-1.5 sm:text-xs">🏪 案件通り</span>
          </Bill>
          {snap.shops.map((shop, i) => (
            <Shop key={shop.id} shop={shop} x={snap.shops.length > 1 ? 3 + (i * 76) / (snap.shops.length - 1) : 45} workers={ORDER.filter((m) => !walking[m] && state[m].projectId === shop.id)} hot={hot === `s:${shop.id}`} />
          ))}
          {(Object.keys(ROOM_BOX) as Room[]).map((r) => (
            <Bill key={r} x={ROOM_BOX[r].left + 4} y={ROOM_BOX[r].top + 6} z={14}>
              <a href={ROOM_BOX[r].href} aria-label={`${ROOMS[r]}: ${ROOM_BOX[r].go}`} className="office-hot group block whitespace-nowrap rounded-md bg-surface/90 px-1 py-0.5 text-[9px] font-bold text-ink-2 shadow-sm sm:px-1.5 sm:text-xs">
                {ROOM_BOX[r].icon} {ROOMS[r]}<span className="hidden font-normal group-hover:inline group-focus-visible:inline"> → {ROOM_BOX[r].go}</span>
              </a>
            </Bill>
          ))}

          {MEMBERS.map((m) => {
            const s = state[m.id];
            const line = lineOf(m.id);
            const p = pos[m.id];
            // 同じ部屋で同じことをしている社員がほかにいれば、吹き出しは先の1人だけに出す（同じ文が重ならないように）
            const shared = !line && !!s.doing && ORDER.slice(0, ORDER.indexOf(m.id)).some((o) => state[o].room === s.room && state[o].doing === s.doing && !lineOf(o));
            // 全員休憩中は、Claude だけが「休憩中」と案内する
            const idleSay = idle && m.id === "anthropic" && times.length > 0 ? "いまは休憩中です。今日の動きは「直近24時間を見る」で見られます" : null;
            const mood: RobotMood = happening?.kind === "publish" ? "happy" : line?.kind === "proposal" ? "alert" : line ? "talk" : s.doing ? "work" : "rest";
            const anim = walking[m.id] ? "office-walk .28s ease-in-out infinite alternate" : s.doing ? "office-work 1.2s ease-in-out infinite" : "office-rest 3s ease-in-out infinite";
            return (
              <Bill key={m.id} x={p.x} y={p.y} z={12} move>
                <button type="button" data-demo-ok onClick={() => setSelected(selected === m.id ? null : m.id)} className="flex flex-col items-center" aria-label={`${m.name}: ${s.doing ?? "休憩中"}`}>
                  {!walking[m.id] && !shared && (line || s.doing || idleSay) && (
                    <span className="mb-1 line-clamp-2 w-max max-w-[7rem] rounded-lg border border-line bg-surface px-1.5 py-1 text-left text-[10px] leading-snug shadow sm:max-w-[12rem] sm:px-2 sm:text-xs">
                      {line ? (
                        <span style={{ color: line.kind === "proposal" ? "var(--accent)" : undefined }}>{line.kind === "proposal" ? "❗ " : ""}{line.text}</span>
                      ) : s.doing ? (
                        <span className="text-ink-2">{WORK_ICON[s.room]} {s.doing}{s.project ? `（${s.project}）` : ""}</span>
                      ) : (
                        <span className="text-ink-2">💤 {idleSay}</span>
                      )}
                    </span>
                  )}
                  <span className="block" style={{ animation: anim, transformOrigin: "50% 100%", filter: selected === m.id || hot === `m:${m.id}` ? `drop-shadow(0 0 8px ${COLOR[m.id]})` : undefined, ["--rb-h" as string]: "clamp(40px, 8vw, 80px)" }}>
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
      {/* aside はサイドメニューに使っているので、ここは section にする（来訪者の画面のテストがメニューを aside で探すため） */}
      <section className="card mt-3 space-y-3 p-3 lg:mt-0" aria-label="社員の状態">
        <h2 className="text-sm font-bold">社員の状態</h2>
        {MEMBERS.map((m) => <MemberRow key={m.id} member={m.id} s={state[m.id]} c={tally[m.id]} line={lineOf(m.id)} walking={walking[m.id]} onHot={setHot} />)}
        <h2 className="border-t border-line pt-2 text-sm font-bold">🏪 案件通り</h2>
        {snap.shops.length ? (
          <ul className="space-y-1 text-xs">
            {snap.shops.map((shop) => {
              const workers = ORDER.filter((m) => !walking[m] && state[m].projectId === shop.id);
              return (
                <li key={shop.id} className="flex items-baseline gap-1" onMouseEnter={() => setHot(`s:${shop.id}`)} onMouseLeave={() => setHot(null)}>
                  <span aria-hidden>{SHOP_ICON[shop.kind]}</span>
                  <a href={`/projects/${shop.id}`} className="min-w-0 flex-1 truncate hover:underline" style={{ color: workers[0] ? COLOR[workers[0]] : undefined, opacity: shop.status === "closed" ? 0.6 : 1 }}>
                    {shop.title}{SHOP_STATUS[shop.status] ? ` ${SHOP_STATUS[shop.status]}` : ""}
                  </a>
                  <span className="num shrink-0 text-muted">{shop.status === "closed" ? "終了" : `👤${shop.visitsToday}${shop.convToday ? ` ✓${shop.convToday}` : ""}`}</span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-xs text-muted">公開中の案件はありません。</p>
        )}
        <p className="text-[10px] text-muted">👤 は今日の訪問、✓ は今日の登録・利用。店を押すと、その案件の画面に移ります。</p>
      </section>
      </div>
      </ScaleCtx.Provider>

      {replaying && (
        <div className="flex items-center gap-2">
          <button type="button" data-demo-ok onClick={() => setPaused(!paused)} className="rounded-lg border border-line px-2 py-1 text-xs" aria-label={paused ? "再生する" : "一時停止する"}>
            {paused ? "▶ 再生" : "⏸ 止める"}
          </button>
          <input
            type="range" min={0} max={times.length - 1} value={cur}
            onChange={(e) => { setStep(Number(e.target.value)); setPaused(true); }}
            onKeyDown={(e) => { if (e.key === " ") { e.preventDefault(); setPaused(!paused); } }}
            className="flex-1" aria-label="再生する時刻"
          />
          <span className="num w-12 text-right text-xs text-muted">{jstHM(times[cur])}</span>
          <button type="button" data-demo-ok onClick={() => { setReplayOn(false); setPaused(false); }} className="rounded-lg bg-accent px-2 py-1 text-xs text-accent-ink">いまに戻る</button>
        </div>
      )}

      {sel && (
        <section className="card space-y-1 p-3 text-sm" aria-live="polite">
          <div className="flex items-baseline gap-2">
            <b style={{ color: COLOR[sel.m] }}>{nameOf(sel.m)}</b>
            <span className="text-ink-2">{ROOMS[sel.s.room]}</span>
            <button type="button" data-demo-ok onClick={() => setSelected(null)} className="ml-auto text-xs text-muted">閉じる</button>
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
