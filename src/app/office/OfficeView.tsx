"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { OfficeSnapshot } from "@/lib/office";
import { HAPPENING, MEMBERS, ROOMS, stateAt, tallyAt, toMs, type Member, type MemberState, type OfficeLine, type OfficeShop, type Room } from "@/lib/officeShared";
import { ROBOT_CSS, Robot, type RobotMood } from "./Robot";

// オフィスの画面。画像のAIで作ったオフィスの背景（public/office/office.jpg、人物なし）の上に、
// ロボット社員（動画と同じ絵）・吹き出し・店の看板・押せる場所を重ねて「いま何をしているか」を見せる
// - 位置はすべて背景の画像の中の％（背景を作り直したら、下の座標も合わせ直す）
// - 社員は部屋ごとに決まった席に座る。部屋を移るときは、出入口と廊下を通って歩く
// - だれかが3分以内に動いていれば「いま」を映す。だれも動いていなければ、確認が必要なもののお知らせだけを出し、直近24時間の動きはボタンで再生する
// - 部屋・家具・店を押すと、その機能の画面に移る（メニューはそのまま残す）

type Pt = { x: number; y: number };
type Rect = { l: number; t: number; r: number; b: number };
const BG = { src: "/office/office.jpg", w: 1536, h: 1024 };

// 部屋（押すと、その部屋に合う機能の画面に移る）。rect は押せる範囲、label は名札の位置
const ROOM_AREA: Record<Room, { rect: Rect; label: Pt; icon: string; href: string; go: string }> = {
  dev: { rect: { l: 15.6, t: 7.8, r: 48.2, b: 37.1 }, label: { x: 21, y: 10 }, icon: "💻", href: "/projects", go: "案件の一覧を見る" },
  meeting: { rect: { l: 51.8, t: 7.8, r: 84.6, b: 37.1 }, label: { x: 53.5, y: 10 }, icon: "🗣️", href: "/meetings", go: "会議の記録を見る" },
  pr: { rect: { l: 10.4, t: 38.1, r: 46.9, b: 64.9 }, label: { x: 11.5, y: 40.5 }, icon: "📣", href: "/growth", go: "集客と投稿を見る" },
  lounge: { rect: { l: 53.4, t: 38.1, r: 90.5, b: 64.9 }, label: { x: 55, y: 40.5 }, icon: "☕", href: "/diary", go: "日報と社員の声を見る" },
};
// 部屋の中の物（押すと、その機能の画面に移る）
const OBJECTS: { rect: Rect; href: string; label: string; badge?: "proposals" }[] = [
  { rect: { l: 58.3, t: 9.6, r: 72.8, b: 17.4 }, href: "/plan", label: "ホワイトボード: 毎日の計画を見る" },
  { rect: { l: 25.7, t: 40, r: 38.4, b: 45.9 }, href: "/proposals", label: "掲示板: 提案箱を見る", badge: "proposals" },
  { rect: { l: 37.8, t: 9.3, r: 45.2, b: 19.5 }, href: "/lab", label: "サーバー: AIの成績を見る" },
  { rect: { l: 61.8, t: 39.8, r: 78.1, b: 48.8 }, href: "/notes", label: "本棚: 資料と教訓を見る" },
  { rect: { l: 79.8, t: 42, r: 84, b: 51.8 }, href: "/live", label: "コーヒーマシン: ライブ（AIの処理の記録）を見る" },
];
const ORDER: Member[] = ["anthropic", "openai", "google"];
// 席（ロボットの足もとの位置）。社員ごとに決まった席に座る
const SEATS: Record<Room, Pt[]> = {
  dev: [{ x: 24.7, y: 31.3 }, { x: 32.9, y: 31.3 }, { x: 40.7, y: 31.3 }],
  meeting: [{ x: 60.2, y: 31.5 }, { x: 65.8, y: 34.5 }, { x: 71.6, y: 31.5 }],
  pr: [{ x: 20.8, y: 63 }, { x: 29.6, y: 63 }, { x: 38.7, y: 63 }],
  lounge: [{ x: 64.5, y: 60.5 }, { x: 69.7, y: 60.5 }, { x: 74.9, y: 60.5 }], // ソファの手前
};
// 作業中に光らせるモニター（開発室と広報デスクの、社員ごとの机）
const MONITORS: Partial<Record<Room, Pt[]>> = {
  dev: [{ x: 25.4, y: 22 }, { x: 33.2, y: 22 }, { x: 41.7, y: 22 }],
  pr: [{ x: 20.5, y: 51.8 }, { x: 29.3, y: 51.8 }, { x: 38.4, y: 51.8 }],
};
// 部屋の出入口。部屋の間は、真ん中の廊下（x = 50）を通る
const DOOR: Record<Room, Pt> = { dev: { x: 47, y: 31 }, meeting: { x: 53, y: 31 }, pr: { x: 46, y: 57 }, lounge: { x: 54, y: 57 } };
const HALL_X = 50;
// 案件通りの店の看板の位置（背景の店は6軒）
const SHOP_SPOTS: Pt[] = [{ x: 15.6, y: 72 }, { x: 27.7, y: 72 }, { x: 40, y: 72 }, { x: 60.5, y: 72 }, { x: 72.6, y: 72 }, { x: 85, y: 72 }]; // ひさしの上

const seatOf = (room: Room, m: Member) => SEATS[room][ORDER.indexOf(m)];
function pathBetween(from: Room, to: Room, m: Member): Pt[] {
  if (from === to) return [seatOf(to, m)];
  const a = DOOR[from];
  const b = DOOR[to];
  return [a, { x: HALL_X, y: a.y }, { x: HALL_X, y: b.y }, b, seatOf(to, m)];
}
const pct = (r: Rect) => ({ left: `${r.l}%`, top: `${r.t}%`, width: `${r.r - r.l}%`, height: `${r.b - r.t}%` });

const COLOR: Record<Member, string> = { anthropic: "var(--series-anthropic)", openai: "var(--series-openai)", google: "var(--series-google)" };
const WORK_ICON: Record<Room, string> = { dev: "⌨️", meeting: "💬", pr: "📮", lounge: "☕" };
const SHOP_ICON: Record<OfficeShop["kind"], string> = { lp: "✉️", tool: "🛠️" };
const SHOP_STATUS: Record<OfficeShop["status"], string> = { open: "", growing: "🌱", hold: "💤", closed: "🔒" };
const STEP_MS = 2500;
const HOP_MS = 550; // 廊下の1区間を歩く時間
const LINE_SECONDS = 120; // 吹き出しを出しておく長さ
const HAPPENING_SECONDS = 90; // 出来事の演出を出しておく長さ

const jstHM = (utc: string) => new Date(toMs(utc) + 9 * 3600_000).toISOString().slice(11, 16);
const nowUtc = () => new Date().toISOString().replace("T", " ").slice(0, 19);
const nameOf = (m: Member) => MEMBERS.find((x) => x.id === m)!.name;

// 押せる場所（透明。乗せる・選ぶと枠が光り、説明が出る）
function HotArea({ rect, href, label, children }: { rect: Rect; href: string; label: string; children?: React.ReactNode }) {
  return (
    <a href={href} aria-label={label} className="office-hot group absolute rounded-lg hover:bg-white/10 focus-visible:bg-white/10" style={pct(rect)}>
      <span className="pointer-events-none absolute left-1/2 top-0 z-30 hidden -translate-x-1/2 -translate-y-full whitespace-nowrap rounded bg-black/80 px-1.5 py-0.5 text-[10px] text-white group-hover:block group-focus-visible:block sm:text-xs">{label}</span>
      {children}
    </a>
  );
}

// 案件通りの店の看板。今日の訪問があれば明るく、撤退した店は薄く。社員が作業中の店は、その社員の色で光る
function ShopSign({ shop, at, workers, hot }: { shop: OfficeShop; at: Pt; workers: Member[]; hot?: boolean }) {
  const closed = shop.status === "closed";
  const glow = workers[0] ? COLOR[workers[0]] : hot ? "var(--accent)" : null;
  return (
    <a
      href={`/projects/${shop.id}`}
      aria-label={`${shop.title}（今日の訪問 ${shop.visitsToday}人）`}
      title={`${shop.title}（今日の訪問 ${shop.visitsToday}人）`}
      className="office-hot absolute z-10 w-max -translate-x-1/2 -translate-y-full rounded-full border bg-black/70 px-1.5 py-0.5 text-center text-[9px] leading-tight text-white shadow backdrop-blur-sm sm:text-[11px]"
      style={{ left: `${at.x}%`, top: `${at.y}%`, borderColor: glow ?? "rgba(255,255,255,.25)", boxShadow: glow ? `0 0 12px ${glow}` : undefined, opacity: closed ? 0.6 : 1 }}
    >
      {(workers.length > 0 || hot) && <span className="block max-w-[8rem] truncate font-bold">{shop.title}</span>}
      <span className="num block whitespace-nowrap">{SHOP_ICON[shop.kind]}{SHOP_STATUS[shop.status]} {closed ? "終了" : `👤${shop.visitsToday}${shop.convToday ? ` ✓${shop.convToday}` : ""}`}</span>
      {workers.length > 0 && <span className="block font-bold" style={{ color: glow ?? undefined }}>{workers.map(nameOf).join("・")}が作業中</span>}
    </a>
  );
}

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

      <div className="gap-3 lg:grid lg:grid-cols-[1fr_15rem]">
      <div className="office-scene card relative w-full overflow-hidden bg-[#0f1a2e] p-0" style={{ aspectRatio: `${BG.w} / ${BG.h}` }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={BG.src} alt="AIの社員のオフィス（開発室・会議室・広報デスク・休憩室と、手前の案件通り）" className="absolute inset-0 h-full w-full select-none object-cover" draggable={false} />

        {/* 部屋と物（押すと機能の画面へ）。部屋の名札も押せる */}
        {(Object.keys(ROOM_AREA) as Room[]).map((r) => (
          <HotArea key={r} rect={ROOM_AREA[r].rect} href={ROOM_AREA[r].href} label={`${ROOMS[r]}: ${ROOM_AREA[r].go}`} />
        ))}
        {OBJECTS.map((o) => (
          <HotArea key={o.href} rect={o.rect} href={o.href} label={o.badge === "proposals" && n.proposals ? `${o.label}（返事待ち ${n.proposals}件）` : o.label}>
            {o.badge === "proposals" && n.proposals > 0 && <span className="num pointer-events-none absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[9px] font-bold text-accent-ink">{n.proposals}</span>}
          </HotArea>
        ))}
        {(Object.keys(ROOM_AREA) as Room[]).map((r) => (
          <Link key={r} href={ROOM_AREA[r].href} aria-label={`${ROOMS[r]}: ${ROOM_AREA[r].go}`} className="office-hot group absolute z-10 whitespace-nowrap rounded-md bg-black/60 px-1 py-0.5 text-[9px] font-bold text-white backdrop-blur-sm sm:px-1.5 sm:text-xs" style={{ left: `${ROOM_AREA[r].label.x}%`, top: `${ROOM_AREA[r].label.y}%` }}>
            {ROOM_AREA[r].icon} {ROOMS[r]}<span className="hidden font-normal group-hover:inline group-focus-visible:inline"> → {ROOM_AREA[r].go}</span>
          </Link>
        ))}

        {/* 作業中の社員の机のモニターが、その社員の色で光る */}
        {(Object.keys(MONITORS) as Room[]).flatMap((r) => MONITORS[r]!.map((p, i) => {
          const m = ORDER[i];
          const on = state[m].room === r && !walking[m];
          return on ? <span key={`${r}${i}`} className="pointer-events-none absolute h-[3%] w-[4%] -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ left: `${p.x}%`, top: `${p.y}%`, background: COLOR[m], opacity: 0.55, filter: "blur(6px)", animation: "rb-blink 2.4s infinite" }} aria-hidden /> : null;
        }))}

        {/* 案件通りの店の看板 */}
        {snap.shops.slice(0, SHOP_SPOTS.length).map((shop, i) => (
          <ShopSign key={shop.id} shop={shop} at={SHOP_SPOTS[i]} workers={ORDER.filter((m) => !walking[m] && state[m].projectId === shop.id)} hot={hot === `s:${shop.id}`} />
        ))}

        {/* ロボット社員（足もとが席の位置に来る） */}
        {MEMBERS.map((m) => {
          const s = state[m.id];
          const line = lineOf(m.id);
          const p = pos[m.id];
          const shared = !line && !!s.doing && ORDER.slice(0, ORDER.indexOf(m.id)).some((o) => state[o].room === s.room && state[o].doing === s.doing && !lineOf(o));
          const idleSay = idle && m.id === "anthropic" && times.length > 0 ? "いまは休憩中です。今日の動きは「直近24時間の動きを見る」で見られます" : null;
          const mood: RobotMood = happening?.kind === "publish" ? "happy" : line?.kind === "proposal" ? "alert" : line ? "talk" : s.doing ? "work" : "rest";
          const anim = walking[m.id] ? "office-walk .28s ease-in-out infinite alternate" : s.doing ? "office-work 1.2s ease-in-out infinite" : "office-rest 3s ease-in-out infinite";
          const edge = p.x < 22 ? "left-0" : p.x > 78 ? "right-0" : "left-1/2 -translate-x-1/2";
          return (
            <div key={m.id} className="absolute z-20" style={{ left: `${p.x}%`, top: `${p.y}%`, transition: `left ${HOP_MS}ms linear, top ${HOP_MS}ms linear` }}>
              <button type="button" data-demo-ok onClick={() => setSelected(selected === m.id ? null : m.id)} className="absolute bottom-0 left-0 flex -translate-x-1/2 flex-col items-center" aria-label={`${m.name}: ${s.doing ?? "休憩中"}`}>
                {!walking[m.id] && !shared && (line || s.doing || idleSay) && (
                  <span className={`absolute bottom-full mb-1 line-clamp-2 w-max max-w-[7rem] rounded-lg border border-white/20 bg-black/75 px-1.5 py-1 text-left text-[10px] leading-snug text-white shadow-lg backdrop-blur-sm sm:max-w-[13rem] sm:px-2 sm:text-xs ${edge}`}>
                    {line ? (
                      <span style={{ color: line.kind === "proposal" ? "#ffd166" : undefined }}>{line.kind === "proposal" ? "❗ " : ""}{line.text}</span>
                    ) : s.doing ? (
                      <span>{WORK_ICON[s.room]} {s.doing}{s.project ? `（${s.project}）` : ""}</span>
                    ) : (
                      <span>💤 {idleSay}</span>
                    )}
                  </span>
                )}
                <span className="block" style={{ animation: anim, transformOrigin: "50% 100%", filter: selected === m.id || hot === `m:${m.id}` ? `drop-shadow(0 0 8px ${COLOR[m.id]})` : "drop-shadow(0 4px 6px rgba(0,0,0,.45))", ["--rb-h" as string]: "clamp(28px, 4.8vw, 66px)" }}>
                  <Robot member={m.id} mood={mood} />
                </span>
                {/* スマホ幅では名前の札が重なるので出さない（押すと名前と状態が出る） */}
                <span className="mt-0.5 hidden rounded bg-black/60 px-1 text-xs font-bold sm:inline-block" style={{ color: COLOR[m.id] }}>{m.name}</span>
              </button>
            </div>
          );
        })}

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
