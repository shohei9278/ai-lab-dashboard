"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { OfficeSnapshot } from "@/lib/office";
import type { LiveSnapshot } from "@/lib/live";
import { LivePanel } from "./LivePanel";
import { HAPPENING, MEMBERS, ROOMS, isOpenShop, stateAt, tallyAt, toMs, type Member, type MemberState, type OfficeHappening, type OfficeLine, type OfficeShop, type Room } from "@/lib/officeShared";
import { Icon, type IconName } from "./Icons";
import { ROBOT_CSS, Robot, type RobotMood } from "./Robot";

// オフィスの画面。画像のAIで作った、上から見たドット絵のオフィスの背景（public/office/office.webp、人物なし）の上に、
// ロボット社員（動画と同じ絵をドット絵にしたもの）・吹き出し・案件の看板・押せる場所を重ねて「いま何をしているか」を見せる
// - 位置はすべて背景の画像の中の％（背景を作り直したら、下の座標も合わせ直す）
// - 社員は部屋ごとに決まった席に座る。部屋を移るときは、出入口と真ん中の廊下を通って歩く
// - だれかが3分以内に動いていれば「いま」を映す。だれも動いていなければ、確認が必要なもののお知らせだけを出し、直近24時間の動きはボタンで再生する
// - 部屋・家具・案件を押すと、その機能の画面に移る（メニューはそのまま残す）

type Pt = { x: number; y: number };
type Rect = { l: number; t: number; r: number; b: number };
const BG = { src: "/office/office.webp", w: 1536, h: 1024 };
// 社員が出入りする部屋: 押せる範囲・名札の位置・席（ロボットの足もと。社員ごとに決まった席）・出入口
const ROOM_AT: Record<Room, { rect: Rect; label: Pt; seats: Pt[]; door: Pt }> = {
  dev: { rect: { l: 1.4, t: 1.5, r: 40.9, b: 32.4 }, label: { x: 24.5, y: 2.5 }, seats: [{ x: 8.8, y: 30 }, { x: 21.2, y: 30 }, { x: 33.2, y: 30 }], door: { x: 41, y: 24 } },
  meeting: { rect: { l: 59.4, t: 1.5, r: 98.4, b: 32.4 }, label: { x: 63, y: 2.5 }, seats: [{ x: 70.5, y: 31 }, { x: 76.5, y: 31 }, { x: 83, y: 31 }], door: { x: 59, y: 24 } },
  pr: { rect: { l: 1.4, t: 34.2, r: 40.9, b: 62.5 }, label: { x: 22, y: 36 }, seats: [{ x: 12.4, y: 59 }, { x: 22.8, y: 59 }, { x: 33.2, y: 59 }], door: { x: 41, y: 58 } },
  lounge: { rect: { l: 59.4, t: 34.2, r: 98.4, b: 62.5 }, label: { x: 60.5, y: 57.5 }, seats: [{ x: 73.5, y: 54 }, { x: 78.5, y: 54 }, { x: 85, y: 57 }], door: { x: 59, y: 58 } }, // ソファと一人掛け
};
const HALL_X = 50.2; // 部屋の間は、真ん中の廊下を通る
// 作業中に光らせるモニター（社員の並び順と同じ）
const MONITORS: Partial<Record<Room, Pt[]>> = { dev: [{ x: 10.4, y: 16.6 }, { x: 21.2, y: 16.6 }, { x: 33.2, y: 16.6 }], pr: [{ x: 12.4, y: 47 }, { x: 22.8, y: 47 }, { x: 33.2, y: 47 }] };
// 社員は入らない部屋（押すと、その機能の画面に移る）
const AREAS: { rect: Rect; label: Pt; icon: IconName; name: string; href: string; go: string }[] = [
  { rect: { l: 59.4, t: 64.5, r: 98.4, b: 95.2 }, label: { x: 66, y: 66 }, icon: "briefcase", name: "社長室", href: "/approvals", go: "判断待ちを見る" }, // 社長（運営者）が判断するものは社長室に。設定は部屋の書類棚から
  { rect: { l: 1.4, t: 65, r: 40.9, b: 95 }, label: { x: 3, y: 66 }, icon: "shop", name: "案件の展示", href: "/projects", go: "案件の一覧を見る" },
];
// 案件の展示の看板の位置（名札の下の、展示台の上の壁。左上の角）。案件は増えていくので、1つずつ並べず、数と今日の訪問をまとめて出す
const SHOWCASE: Pt = { x: 3, y: 71 };
const SIDE_SHOPS = 5; // 横の一覧に出す案件の数（今日の訪問が多い順）

// 部屋の名前のほかの情報（押すと、その部屋に合う機能の画面に移る）
const ROOM_META: Record<Room, { icon: IconName; href: string; go: string }> = {
  dev: { icon: "monitor", href: "/lab", go: "AIの成績を見る" },
  meeting: { icon: "chat", href: "/meetings", go: "会議の記録を見る" },
  pr: { icon: "megaphone", href: "/growth", go: "集客と投稿を見る" },
  lounge: { icon: "coffee", href: "/diary", go: "日報と社員の声を見る" },
};
// 部屋の中の物（押すと、その機能の画面に移る）
// badge: 件数の丸（proposals = 提案箱の返事待ち、approvals = 判断待ち）
const OBJECTS: { rect: Rect; href: string; label: string; badge?: "proposals" | "approvals" }[] = [
  { rect: { l: 72.6, t: 73.7, r: 87.2, b: 87.4 }, href: "/approvals", label: "社長の机: 判断待ちを見る", badge: "approvals" },
  { rect: { l: 94.6, t: 67.5, r: 98.3, b: 77 }, href: "/settings", label: "書類棚: 設定を見る" },
  { rect: { l: 71, t: 2.4, r: 85, b: 9.6 }, href: "/plan", label: "ホワイトボード: 毎日の計画を見る" },
  { rect: { l: 9.4, t: 35.6, r: 19.7, b: 42.3 }, href: "/proposals", label: "掲示板: 提案箱を見る", badge: "proposals" },
  { rect: { l: 11, t: 3, r: 23.5, b: 11.5 }, href: "#live", label: "サーバー: ライブ（AIの会話と処理の記録）を見る" },
  { rect: { l: 67, t: 36.6, r: 77.3, b: 45.4 }, href: "/notes", label: "本棚: 資料と教訓を見る" },
  { rect: { l: 81, t: 36, r: 90.5, b: 46.4 }, href: "/outside", label: "コーヒーマシン: 外の声を見る" },
];
const ORDER: Member[] = ["anthropic", "openai", "google"];

const seatOf = (room: Room, m: Member) => ROOM_AT[room].seats[ORDER.indexOf(m)];
function pathBetween(from: Room, to: Room, m: Member): Pt[] {
  if (from === to) return [seatOf(to, m)];
  const a = ROOM_AT[from].door;
  const b = ROOM_AT[to].door;
  return [a, { x: HALL_X, y: a.y }, { x: HALL_X, y: b.y }, b, seatOf(to, m)];
}
const pct = (r: Rect) => ({ left: `${r.l}%`, top: `${r.t}%`, width: `${r.r - r.l}%`, height: `${r.b - r.t}%` });

const COLOR: Record<Member, string> = { anthropic: "var(--series-anthropic)", openai: "var(--series-openai)", google: "var(--series-google)" };
const SHOP_ICON: Record<OfficeShop["kind"], { icon: IconName; label: string }> = { lp: { icon: "page", label: "LP" }, tool: { icon: "tool", label: "ツール" } };
const SHOP_STATUS: Record<OfficeShop["status"], { icon: IconName; label: string } | null> = { open: null, growing: { icon: "sprout", label: "育てる段階" }, hold: { icon: "pause", label: "公開中・集客お休み" }, closed: { icon: "lock", label: "受付終了" } };
const HAPPENING_ICON: Record<OfficeHappening["kind"], IconName> = { publish: "party", close: "box", grow: "sprout" };
const STEP_MS = 2500;
const HOP_MS = 550; // 廊下の1区間を歩く時間
const LINE_SECONDS = 120; // 吹き出しを出しておく長さ
const HAPPENING_SECONDS = 90; // 出来事の演出を出しておく長さ

const jstHM = (utc: string) => new Date(toMs(utc) + 9 * 3600_000).toISOString().slice(11, 16);
const nowUtc = () => new Date().toISOString().replace("T", " ").slice(0, 19);
const nameOf = (m: Member) => MEMBERS.find((x) => x.id === m)!.name;

// 押せる場所（透明。乗せる・選ぶと枠が光り、説明が出る）
function HotArea({ rect, href, label, children, onClick }: { rect: Rect; href: string; label: string; children?: React.ReactNode; onClick?: () => void }) {
  return (
    // 部屋や物の範囲そのものは、ロボットや名札より後ろのまま（乗せても前に出さない。前に出すと、部屋の中のロボットが押せなくなる）
    // 光らせ方に filter を使うと重なりの層ができて説明が名札の後ろに隠れるので、枠線と薄い色だけにする（説明だけが前に出る）
    <a href={href} aria-label={label} onClick={onClick} className="office-area group absolute rounded-lg hover:bg-white/10 focus-visible:bg-white/10" style={pct(rect)}>
      {/* 説明は枠の上に出す。絵の上の端に近いものは上に出すと切れるので、大きな部屋は枠の内側の下、小さな物は枠の下に出す。
          左右の端に近いものは、真ん中にそろえると切れるので、端の側にそろえる */}
      <span className={`pointer-events-none absolute z-30 hidden ${rect.r > 85 ? "right-0" : rect.l < 15 ? "left-0" : "left-1/2 -translate-x-1/2"} ${rect.t >= 12 ? "top-0 -translate-y-full" : rect.b - rect.t > 15 ? "bottom-1" : "top-full mt-1"} whitespace-nowrap rounded bg-black/80 px-1.5 py-0.5 text-[10px] text-white group-hover:block group-focus-visible:block sm:text-xs`}>{label}</span>
      {children}
    </a>
  );
}

// 案件の展示の看板。案件は増えていくので、1つずつ並べず「公開中の数・今日の訪問・登録」をまとめて出す。
// 社員が案件の作業をしているときは、その案件の名前と社員を、社員の色で光らせて出す
function ShowcaseSign({ shops, working, link = true }: { shops: OfficeShop[]; working: { m: Member; id: number | null; title: string }[]; link?: boolean }) {
  const open = shops.filter(isOpenShop);
  const visits = open.reduce((a, s) => a + s.visitsToday, 0);
  const conv = open.reduce((a, s) => a + s.convToday, 0);
  // 作業中の案件が2件以上あるときは、1件だけを出すと取り違えるので「◯件を作業中」にして、案件の一覧へ移す
  const projects = [...new Map(working.map((x) => [x.id ?? x.title, x])).values()];
  const w = projects.length === 1 ? projects[0] : null;
  const who = working.map((x) => nameOf(x.m)).filter((n, i, a) => a.indexOf(n) === i).join("・");
  const glow = working.length ? COLOR[working[0].m] : null;
  const doing = w ? `${who}が作業中: ${w.title}` : projects.length > 1 ? `${who}が${projects.length}件の案件を作業中` : null;
  const Tag = link ? "a" : "div";
  return (
    <Tag
      href={link ? (w?.id ? `/projects/${w.id}` : "/projects") : undefined}
      aria-label={doing ?? `公開中の案件 ${open.length}件・今日の訪問 ${visits}人`}
      className={`${link ? "office-hot " : ""}absolute z-10 w-max max-w-[37%] rounded-lg border bg-black/75 px-2 py-1 text-left text-[10px] leading-snug text-white shadow backdrop-blur-sm sm:text-xs`}
      style={{ left: `${SHOWCASE.x}%`, top: `${SHOWCASE.y}%`, borderColor: glow ?? "rgba(255,255,255,.25)", boxShadow: glow ? `0 0 12px ${glow}` : undefined }}
    >
      <span className="num flex items-center gap-2 whitespace-nowrap">
        <span>公開中 <b>{open.length}</b>件</span>
        <span className="flex items-center gap-0.5"><Icon name="user" label="今日の訪問" />{visits}</span>
        {conv > 0 && <span className="flex items-center gap-0.5"><Icon name="check" label="今日の登録・利用" />{conv}</span>}
      </span>
      {/* スマホ幅では展示台が隠れるので、作業中の案件名は出さない（絵の下の一覧で見られる） */}
      {doing && <span className="hidden truncate font-bold sm:block" style={{ color: glow ?? undefined }}>{doing}</span>}
    </Tag>
  );
}

const KEYFRAMES = `
@keyframes office-walk { from { transform: translateY(0) } to { transform: translateY(-4px) } }
@keyframes office-work { 0%, 100% { transform: rotate(0) } 25% { transform: rotate(-4deg) } 75% { transform: rotate(4deg) } }
@keyframes office-rest { 0%, 100% { transform: scale(1) } 50% { transform: scale(1.04) } }
@keyframes office-pop { 0% { transform: translateY(8px) scale(.8); opacity: 0 } 12% { transform: translateY(0) scale(1); opacity: 1 } 85% { opacity: 1 } 100% { transform: translateY(-6px); opacity: 0 } }
@keyframes office-burst { from { transform: translateY(0); opacity: 1 } to { transform: translateY(-60px); opacity: 0 } }
.office-hot { cursor: pointer; transition: filter .15s, box-shadow .15s }
.office-hot:hover, .office-hot:focus-visible { filter: brightness(1.08) saturate(1.25); outline: 2px solid var(--accent); outline-offset: 2px }
.office-area { cursor: pointer }
.office-area:hover, .office-area:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px }
@media (prefers-reduced-motion: reduce) { .office-scene * { animation: none !important; transition: none !important } }
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

// オフィスの横の欄のタブ
type SideTab = "live" | "members" | "shops";
const SIDE_TABS: { id: SideTab; label: string }[] = [{ id: "live", label: "ライブ" }, { id: "members", label: "社員の状態" }, { id: "shops", label: "案件" }];
const RECENT_LINES = 5; // 社員を押したときに出す、最近の発言の数

// 横の一覧の1人分（スマホでは絵の下に出る）。乗せると、絵の中のその社員が光る
// AIの会話（提案・採点・判断・議論）の中身は長いので、ここには出さず、オフィスの下のライブの欄に出す
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
// live: 下に出すライブの欄の最初のデータ（渡したときだけ出す。再生の時刻に合わせるため、オフィスの中に置く）
// controls: ライブの欄に出す、運営者の指示のボタン（運営者のときだけ渡す）
// showcase: 概要ページ（/showcase）の、来訪者が見るだけの形。部屋や物から機能の画面に移らず、横の欄も出さない。データは /api/showcase/office から読む
export function OfficeView({ initial, owner = false, numbers = true, live, controls, showcase = false }: { initial: OfficeSnapshot; owner?: boolean; numbers?: boolean; live?: LiveSnapshot; controls?: React.ReactNode; showcase?: boolean }) {
  const [snap, setSnap] = useState(initial);
  const [now, setNow] = useState(initial.now);
  const [step, setStep] = useState(0);
  const [replayOn, setReplayOn] = useState(false);
  const [paused, setPaused] = useState(false);
  const [selected, setSelected] = useState<Member | null>(null);
  const [hot, setHot] = useState<string | null>(null);
  const [side, setSide] = useState<SideTab>(live ? "live" : "members");
  // ページのどこかで #live へのリンク（ホームの下のリンク・右下のバッジなど）が押されたら、ライブのタブを開く
  // （同じページの中の移動では、URLの # が変わった知らせが出ないことがあるので、押されたこと自体を拾う）
  useEffect(() => {
    if (!live) return;
    const open = () => setSide("live");
    const onClick = (e: MouseEvent) => { if ((e.target as Element | null)?.closest?.('a[href$="#live"]')) open(); };
    const onHash = () => { if (window.location.hash === "#live") open(); };
    document.addEventListener("click", onClick, true);
    window.addEventListener("hashchange", onHash);
    return () => { document.removeEventListener("click", onClick, true); window.removeEventListener("hashchange", onHash); };
  }, [live]);

  // 10秒ごとに新しい記録を読む
  useEffect(() => {
    const t = setInterval(async () => {
      const r = await fetch(showcase ? "/api/showcase/office" : "/api/office", { cache: "no-store" }).catch(() => null);
      if (r?.ok) setSnap((await r.json()) as OfficeSnapshot);
    }, 10_000);
    return () => clearInterval(t);
  }, [showcase]);

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
  // lineOf: いま話していること（表情を「話している」にする）/ bubbleOf: 吹き出しに出す短いもの（声・提案。AIの会話は長いので出さない）
  const recentOf = (m: Member, ok: (l: OfficeLine) => boolean): OfficeLine | undefined =>
    [...snap.lines].reverse().find((l) => l.member === m && ok(l) && toMs(l.at) <= t && t - toMs(l.at) <= LINE_SECONDS * 1000);
  const lineOf = (m: Member) => recentOf(m, () => true);
  const bubbleOf = (m: Member) => recentOf(m, (l) => l.kind !== "talk");
  const happening = [...snap.happenings].reverse().find((h) => toMs(h.at) <= t && t - toMs(h.at) <= HAPPENING_SECONDS * 1000);
  const working = ORDER.filter((m) => state[m].room !== "lounge").length;
  const n = snap.numbers;
  const yen = (v: number) => `${v.toLocaleString("ja-JP")}円`;

  // 歩く: 部屋が変わったら、廊下の点を1つずつたどる
  // 最初は、開いた時点にいる部屋の席から始める（休憩室から始めると、ずっと作業していた社員まで、開くたびに歩いてくるように見えるため）
  const [startRooms] = useState(() => {
    const st = stateAt(initial.events, initial.now);
    return Object.fromEntries(ORDER.map((m) => [m, st[m].room])) as Record<Member, Room>;
  });
  const [pos, setPos] = useState<Record<Member, Pt>>(() => Object.fromEntries(ORDER.map((m) => [m, seatOf(startRooms[m], m)])) as Record<Member, Pt>);
  const [walking, setWalking] = useState<Record<Member, boolean>>({ anthropic: false, openai: false, google: false });
  const roomRef = useRef<Record<Member, Room>>({ ...startRooms });
  const timers = useRef<Record<Member, ReturnType<typeof setTimeout>[]>>({ anthropic: [], openai: [], google: [] });
  const rooms = ORDER.map((m) => state[m].room).join(",");
  // 端末の「動きを減らす」設定。途中で変わったときも拾い、歩いている途中なら、その場で行き先の席に置く
  const reduced = useRef(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    reduced.current = mq.matches;
    const onChange = () => {
      reduced.current = mq.matches;
      if (!mq.matches) return;
      for (const m of ORDER) {
        timers.current[m].forEach(clearTimeout);
        timers.current[m] = [];
      }
      setPos(Object.fromEntries(ORDER.map((m) => [m, seatOf(roomRef.current[m], m)])) as Record<Member, Pt>);
      setWalking({ anthropic: false, openai: false, google: false });
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
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
      // 端末で「動きを減らす」にしている人には、廊下を歩かせず、行き先の席にそのまま置く（CSSの動きを止めるだけでは、歩く座標の更新が残るため）
      if (reduced.current) {
        const seat = seatOf(to, m);
        all[m] = [setTimeout(() => setPos((c) => ({ ...c, [m]: seat })), 0)];
        return;
      }
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

  // 同じ部屋で何人も話しているときは、吹き出しが重なって読めないので、いちばん新しく話した1人だけ出す（ほかの人は口だけ動く）
  const speaker = new Map<Room, { m: Member; at: string }>();
  for (const m of ORDER) {
    const l = bubbleOf(m);
    if (!l || walking[m]) continue;
    const r = state[m].room;
    const cur = speaker.get(r);
    if (!cur || l.at > cur.at) speaker.set(r, { m, at: l.at });
  }
  const showLine = (m: Member) => speaker.get(state[m].room)?.m === m;

  const sel = selected
    ? { m: selected, s: state[selected], c: tally[selected], recent: snap.lines.filter((l) => l.member === selected && toMs(l.at) <= t).slice(-RECENT_LINES).reverse() }
    : null;

  return (
    // data-demo-ok: このボタン（社員を押す・再生する）は見るだけで何も変えないので、来訪者にも押せるようにする（GuestGuard の対象外）
    <div className="space-y-3" data-demo-ok>
      <style>{KEYFRAMES + ROBOT_CSS}</style>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="rounded-full px-2 py-0.5 text-xs font-medium" style={{ background: !replaying && liveNow ? "var(--good)" : "var(--surface-2)", color: !replaying && liveNow ? "#fff" : "var(--text-2)" }}>
          {!replaying ? (liveNow ? "● いま（作業中）" : "● いま（全員休憩中）") : <><Icon name={paused ? "pause" : "play"} className="mr-1 h-[1em] w-[1em]" />{paused ? "一時停止中（直近24時間）" : "直近24時間を再生中"}</>}
        </span>
        <span className="num text-ink-2">{jstHM(at)}</span>
        <span className="ml-auto text-xs text-muted">{showcase ? "社員を押すと、いまの作業が出ます" : "部屋・家具・案件の看板を押すと、その機能の画面に移ります"}</span>
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
      <p className="-mt-1 text-[10px] text-muted">数字は、再生中もいまのものです（稼働・待機だけ、再生している時刻のもの）。公開中・集客中は{n.live}件。</p>
      </>)}

      {/* だれも動いていないとき: いまの状態・次の予定・確認が必要なもの。過去の動きはボタンで再生する（絵には重ねない） */}
      {idle && (
        <div className="card flex flex-wrap items-center gap-x-4 gap-y-1.5 p-2.5 text-xs sm:text-sm" role="status">
          <p className="flex items-center gap-1 font-bold"><Icon name="moon" />いまは全員休憩中です</p>
          <p className="text-ink-2">{n.killSwitch ? "緊急停止中のため、AIは動きません" : n.dailyHour !== null ? `次の自動実行は毎日${n.dailyHour}時ごろ（朝の計画のあと、予定の時刻に投稿や判断をします）` : "毎日の自動実行はオフです"}</p>
          {(n.approvals > 0 || n.proposals > 0 || n.waiting > 0) && (
            <ul className="flex flex-wrap gap-x-3 gap-y-0.5">
              {n.approvals > 0 && <li><a href="/approvals" className="text-accent underline">判断待ち {n.approvals}件</a>{owner ? "：確認してください" : "（運営者の確認待ち）"}</li>}
              {n.proposals > 0 && <li><a href="/proposals" className="text-accent underline">提案箱の返事待ち {n.proposals}件</a>{owner ? "：提案があるので確認してください" : ""}</li>}
              {n.waiting > 0 && <li><Link href="/#waiting" className="text-accent underline">{owner ? "あなた" : "運営者"}の確認・対応 {n.waiting}件</Link>{n.stuck ? `（止まっている ${n.stuck}件）` : ""}</li>}
            </ul>
          )}
          {times.length > 0 && (
            <button type="button" data-demo-ok onClick={startReplay} className="ml-auto rounded-lg bg-accent px-3 py-1 text-xs font-medium text-accent-ink"><Icon name="play" className="mr-1 h-[1em] w-[1em]" />直近24時間の動きを見る（{times.length}件）</button>
          )}
        </div>
      )}

      <div className={showcase ? "" : "gap-3 lg:grid lg:grid-cols-[minmax(0,1fr)_21rem]"}>
      <div className="office-scene card relative w-full overflow-hidden bg-[#e6e6e6] p-0" style={{ aspectRatio: `${BG.w} / ${BG.h}` }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={BG.src} style={{ imageRendering: "pixelated" }} alt="AIの社員のオフィス（開発室・会議室・広報デスク・休憩室・社長室・案件の展示）" className="absolute inset-0 h-full w-full select-none object-cover" draggable={false} />

        {/* 部屋と物（押すと機能の画面へ）。部屋の名札も押せる。概要ページでは押せる場所を置かず、名札だけ出す */}
        {!showcase && (Object.keys(ROOM_META) as Room[]).map((r) => (
          <HotArea key={r} rect={ROOM_AT[r].rect} href={ROOM_META[r].href} label={`${ROOMS[r]}: ${ROOM_META[r].go}`} />
        ))}
        {!showcase && AREAS.map((a) => (
          <HotArea key={a.name} rect={a.rect} href={a.href} label={`${a.name}: ${a.go}`} />
        ))}
        {!showcase && OBJECTS.map((o) => {
          const count = o.badge ? n[o.badge] : 0;
          const what = o.badge === "approvals" ? (owner ? "判断待ち" : "運営者の確認待ち") : "返事待ち";
          return (
            <HotArea key={o.href} rect={o.rect} href={o.href} onClick={o.href === "#live" ? () => setSide("live") : undefined} label={count ? `${o.label}（${what} ${count}件）` : o.label}>
              {count > 0 && <span className="num pointer-events-none absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[9px] font-bold text-accent-ink">{count}</span>}
            </HotArea>
          );
        })}
        {[
          ...(Object.keys(ROOM_META) as Room[]).map((r) => ({ key: r, at: ROOM_AT[r].label, icon: ROOM_META[r].icon, name: ROOMS[r], href: ROOM_META[r].href, go: ROOM_META[r].go })),
          ...AREAS.map((a) => ({ key: a.name, at: a.label, icon: a.icon, name: a.name, href: a.href, go: a.go })),
        ].map((r) => showcase ? (
          <span key={r.key} className="pointer-events-none absolute z-10 whitespace-nowrap rounded-md bg-black/60 px-1 py-0.5 text-[9px] font-bold text-white backdrop-blur-sm sm:px-1.5 sm:text-xs" style={{ left: `${r.at.x}%`, top: `${r.at.y}%` }}>
            <Icon name={r.icon} className="mr-0.5 h-[1em] w-[1em]" />{r.name}
          </span>
        ) : (
          <Link key={r.key} href={r.href} aria-label={`${r.name}: ${r.go}`} className="office-hot group absolute z-10 whitespace-nowrap rounded-md bg-black/60 px-1 py-0.5 text-[9px] font-bold text-white backdrop-blur-sm sm:px-1.5 sm:text-xs" style={{ left: `${r.at.x}%`, top: `${r.at.y}%` }}>
            <Icon name={r.icon} className="mr-0.5 h-[1em] w-[1em]" />{r.name}<span className="hidden font-normal group-hover:inline group-focus-visible:inline"> → {r.go}</span>
          </Link>
        ))}

        {/* 作業中の社員の机のモニターが、その社員の色で光る */}
        {(Object.keys(MONITORS) as Room[]).flatMap((r) => MONITORS[r]!.map((p, i) => {
          const m = ORDER[i];
          const on = state[m].room === r && !walking[m];
          return on ? <span key={`${r}${i}`} className="pointer-events-none absolute h-[3%] w-[4%] -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ left: `${p.x}%`, top: `${p.y}%`, background: COLOR[m], opacity: 0.55, filter: "blur(6px)", animation: "rb-blink 2.4s infinite" }} aria-hidden /> : null;
        }))}

        {/* 案件の展示台の看板 */}
        <ShowcaseSign link={!showcase} shops={snap.shops} working={ORDER.filter((m) => !walking[m] && state[m].project).map((m) => ({ m, id: state[m].projectId, title: state[m].project! }))} />

        {/* ロボット社員（足もとが席の位置に来る） */}
        {MEMBERS.map((m) => {
          const s = state[m.id];
          const said = lineOf(m.id);
          const bub = bubbleOf(m.id);
          const line = bub && showLine(m.id) ? bub : undefined;
          const p = pos[m.id];
          const shared = !!bub && !line ? true : !line && !!s.doing && ORDER.slice(0, ORDER.indexOf(m.id)).some((o) => state[o].room === s.room && state[o].doing === s.doing && !bubbleOf(o));
          const idleSay = idle && m.id === "anthropic" && times.length > 0 ? "いまは休憩中です。今日の動きは、上のボタンで見られます" : null;
          const mood: RobotMood = happening?.kind === "publish" ? "happy" : said?.kind === "proposal" ? "alert" : said ? "talk" : s.doing ? "work" : "rest";
          const anim = walking[m.id] ? "office-walk .28s ease-in-out infinite alternate" : s.doing ? "office-work 1.2s ease-in-out infinite" : "office-rest 3s ease-in-out infinite";
          const edge = p.x < 22 ? "left-0" : p.x > 78 ? "right-0" : "left-1/2 -translate-x-1/2";
          // 上の部屋（開発室・会議室）では、吹き出しを足もとの下に出す（上に出すと、長いときに絵の上の端で切れる）
          const below = p.y < 40;
          return (
            <div key={m.id} className="absolute z-20" style={{ left: `${p.x}%`, top: `${p.y}%`, transition: `left ${HOP_MS}ms linear, top ${HOP_MS}ms linear` }}>
              <button type="button" data-demo-ok onClick={() => setSelected(selected === m.id ? null : m.id)} className="absolute bottom-0 left-0 flex -translate-x-1/2 flex-col items-center" aria-label={`${m.name}: ${s.doing ?? "休憩中"}`}>
                {!walking[m.id] && !shared && (line || s.doing || idleSay) && (
                  <span className={`absolute z-10 ${below ? "top-full mt-1" : "bottom-full mb-1"} ${idleSay && !line && !s.doing ? "hidden sm:block" : "block"} w-max max-w-[8rem] rounded-lg border border-white/20 bg-black/75 px-1.5 py-1 text-left text-[10px] leading-snug text-white shadow-lg backdrop-blur-sm sm:max-w-[16rem] sm:px-2 sm:text-xs ${edge}`}>
                    {line ? (
                      <span style={{ color: line.kind === "proposal" ? "#ffd166" : undefined }}>{line.kind === "proposal" && <Icon name="alert" className="mr-1 h-[1em] w-[1em]" label="提案" />}{line.text}</span>
                    ) : s.doing ? (
                      <span>{s.doing}{s.project ? `（${s.project}）` : ""}</span>
                    ) : (
                      <span>{idleSay}</span>
                    )}
                  </span>
                )}
                <span className="block" style={{ animation: anim, transformOrigin: "50% 100%", filter: selected === m.id || hot === `m:${m.id}` ? `drop-shadow(0 0 8px ${COLOR[m.id]})` : "drop-shadow(0 4px 6px rgba(0,0,0,.45))", ["--rb-h" as string]: "clamp(28px, 4.8vw, 66px)" }}>
                  <Robot member={m.id} mood={mood} pixel />
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
                <span key={i} className="absolute h-2 w-2" style={{ left: `calc(50% + ${-48 + i * 24}px)`, top: "-8px", background: ["#ff6b6b", "#ffd166", "#06d6a0", "#4dabf7", "#c77dff"][i], animation: `office-burst 1.6s ${i * 0.12}s ease-out forwards` }} />
              ))}
              <div className="max-w-[80vw] rounded-full border border-line bg-surface px-3 py-1 text-xs font-bold shadow-lg sm:text-sm">
                <Icon name={HAPPENING_ICON[happening.kind]} className="mr-1 h-[1em] w-[1em]" />{happening.title ? `「${happening.title}」` : "案件"}{HAPPENING[happening.kind].label}
              </div>
            </div>
          </div>
        )}
      </div>
      {/* オフィスの横の欄（スマホでは絵の下）: ライブ・社員の状態・案件をタブで切り替える。最初はライブ（ロボットの動きと会話を一緒に見るため）
          PCでは絵と同じ高さにそろえ、中だけスクロールする（欄の中身で行の高さが伸びないよう、中身は absolute で置く）
          aside はサイドメニューに使っているので、ここは div と section にする（来訪者の画面のテストがメニューを aside で探すため） */}
      {!showcase && <div id="live" className="card mt-3 scroll-mt-4 p-0 lg:relative lg:mt-0">
        <div className="flex flex-col lg:absolute lg:inset-0">
          <div role="tablist" aria-label="オフィスの横の欄" className="flex gap-1 border-b border-line p-2">
            {SIDE_TABS.filter((x) => x.id !== "live" || live).map((x) => (
              <button key={x.id} type="button" role="tab" data-demo-ok aria-selected={side === x.id} onClick={() => setSide(x.id)}
                className={`rounded-md px-2.5 py-1 text-xs ${side === x.id ? "bg-accent font-bold text-accent-ink" : "text-ink-2 hover:bg-surface-2"}`}>
                {x.label}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {side === "live" && live && (
              <LivePanel
                initial={live}
                owner={owner}
                controls={controls}
                replay={replaying ? {
                  at,
                  log: snap.events.map((e, i) => ({ e, i })).filter(({ e }) => !e.talk && toMs(e.at) <= t).slice(-40).map(({ e, i }) => ({
                    key: `r${i}-${e.at}`, at: e.at, member: e.member, head: nameOf(e.member),
                    text: `${ROOMS[e.room]}で${e.doing}${e.project ? `（${e.project}）` : ""}`, tail: e.yen >= 0.5 ? `${Math.round(e.yen)}円` : "",
                  })),
                } : null}
              />
            )}
            {side === "members" && (
              <section className="space-y-3" aria-label="社員の状態">
        {MEMBERS.map((m) => <MemberRow key={m.id} member={m.id} s={state[m.id]} c={tally[m.id]} line={lineOf(m.id)} walking={walking[m.id]} onHot={setHot} />)}
              </section>
            )}
            {side === "shops" && (
              <section className="space-y-3" aria-label="案件の展示">
        <h2 className="flex items-center gap-1 text-sm font-bold"><Icon name="shop" />案件の展示<span className="num ml-auto text-xs font-normal text-muted">公開中 {snap.shops.filter(isOpenShop).length}件</span></h2>
        {/* 案件は増えていくので、作業中の案件と、今日の訪問が多い順に5件だけ出し、残りは案件の一覧で見る */}
        {snap.shops.length ? (() => {
          const busy = new Set(ORDER.filter((m) => !walking[m]).map((m) => state[m].projectId));
          const list = [...snap.shops.filter((x) => busy.has(x.id)), ...snap.shops.filter((x) => !busy.has(x.id))].slice(0, SIDE_SHOPS);
          const rest = snap.shops.length - list.length;
          return (
            <ul className="space-y-1 text-xs">
              {list.map((shop) => {
                const workers = ORDER.filter((m) => !walking[m] && state[m].projectId === shop.id);
                const st = SHOP_STATUS[shop.status];
                return (
                  <li key={shop.id} className="flex items-center gap-1">
                    <Icon name={SHOP_ICON[shop.kind].icon} label={SHOP_ICON[shop.kind].label} className="h-3.5 w-3.5 text-muted" />
                    <a href={`/projects/${shop.id}`} className="min-w-0 flex-1 truncate hover:underline" style={{ color: workers[0] ? COLOR[workers[0]] : undefined, opacity: shop.status === "closed" ? 0.6 : 1 }}>
                      {shop.title}
                    </a>
                    {st && <Icon name={st.icon} label={st.label} className="h-3.5 w-3.5 text-muted" />}
                    <span className="num flex shrink-0 items-center gap-0.5 text-muted">
                      {shop.status === "closed" ? "終了" : <><Icon name="user" label="今日の訪問" className="h-3 w-3" />{shop.visitsToday}{shop.convToday > 0 && <><Icon name="check" label="今日の登録・利用" className="ml-1 h-3 w-3" />{shop.convToday}</>}</>}
                    </span>
                  </li>
                );
              })}
              {rest > 0 && <li><Link href="/projects" className="text-accent underline">ほか{rest}件は案件の一覧へ</Link></li>}
            </ul>
          );
        })() : (
          <p className="text-xs text-muted">公開中の案件はありません。</p>
        )}
        <p className="text-[10px] text-muted">人の印は今日の訪問、チェックの印は今日の登録・利用。名前を押すと、その案件の画面に移ります。</p>
              </section>
            )}
          </div>
        </div>
      </div>}
      </div>

      {replaying && (
        <div className="flex items-center gap-2">
          <button type="button" data-demo-ok onClick={() => setPaused(!paused)} className="rounded-lg border border-line px-2 py-1 text-xs" aria-label={paused ? "再生する" : "一時停止する"}>
            <Icon name={paused ? "play" : "pause"} className="mr-1 h-[1em] w-[1em]" />{paused ? "再生" : "止める"}
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
          {sel.recent.length > 0 && (
            <div className="border-t border-line pt-2">
              <p className="mb-1 text-xs text-muted">最近の発言（新しい順・全文{showcase ? "" : <>。ほかの社員の発言も、<a href="#live" onClick={() => setSide("live")} className="underline">ライブ</a>のタブで見られます</>}）</p>
              <ol className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
                {sel.recent.map((l, i) => (
                  <li key={`${l.at}${i}`} className="text-xs">
                    <span className="num mr-1 text-muted">{jstHM(l.at)}</span>
                    <span className="text-ink-2">{l.kind === "talk" ? `${l.about}${l.project ? `（${l.project}）` : ""}` : l.kind === "proposal" ? "提案箱に提案" : "ひとこと"}</span>
                    <p className="mt-0.5 whitespace-pre-wrap">{l.kind === "proposal" ? l.text.replace(/^提案があります: /, "") : l.text}</p>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </section>
      )}

    </div>
  );
}
