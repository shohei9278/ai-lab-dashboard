// 遊びの深さ: 来た人1人あたり、どれだけ遊んだか（来た人数に左右されない、面白さの目安。運営者が決めた）
// - 遊び始めた: 枠の中で初めて触った・押した・振ったときに、遊んだ時間の 0秒 として知らせる（遊びの深さの割合の分母。PR #123 の ai-review の指摘）
// - 遊んだ時間: 枠の中で触った・押した・振ったときから10秒のあいだを「遊んでいる」として、画面に出ていた実際の経過時間を足す
//   （1秒ごとの合図の回数では数えない。重いゲームで処理が止まったり、ブラウザが合図を間引いたりしても短くならないように。PR #123 の ai-review の指摘）
// - 結果を出した回数: ツールが結果を知らせた回数（labShare と labResult が組で続けて来たら1回。同じ種類が続いたら別の回。quiet の途中の結果も数える）
// - 出した結果の種類: labResult の番号の種類の数（集めるツールなら、どこまで集めたか）
// それぞれ、決まった区切り（15秒・30秒…、2回・3回…、1種類・2種類…）を超えたときに1度だけ知らせる（公開サイトの記録は、人・区切りごとに1日1件）

export const PLAY_TIME_MARKS = [15, 30, 60, 120, 300, 600] as const; // 秒
export const RESULT_MARKS = [2, 3, 5, 10] as const; // 回
export const ACTIVE_WINDOW_MS = 10_000; // 触ってから、この間は遊んでいるとみなす
const SAME_RESULT_MS = 1000; // この間に、labShare と labResult が組で続けて来たら、同じ1回の結果とみなす
const SHAKE = 4; // m/s²。ならした値からこれ以上ずれた動きを、振った（遊んでいる）とみなす

export type DepthName = "play_time" | "results" | "result_kinds";
export type DepthEvent = { name: DepthName; value: number };
type ResultKind = "share" | "result";

// 記録してよい値（公開サイトの受け口とダッシュボードの集計で、ありえない値を外す。PR #123 の ai-review の指摘）
export const RESULT_KINDS_MAX = 100;
// 遊びの深さでない名前は、ここでは確かめない（true）
export function depthValueOk(name: string, value: string): boolean {
  if (name !== "play_time" && name !== "results" && name !== "result_kinds") return true;
  if (!/^\d+$/.test(value)) return false;
  const n = Number(value);
  if (name === "play_time") return n === 0 || (PLAY_TIME_MARKS as readonly number[]).includes(n);
  if (name === "results") return (RESULT_MARKS as readonly number[]).includes(n);
  return n >= 1 && n <= RESULT_KINDS_MAX;
}

export function playDepth(emit: (e: DepthEvent) => void) {
  let lastActive = -Infinity;
  let since = -Infinity; // 今続けて遊んでいる間の始まり（触ってから10秒以上あいたら、次に触ったときから測り直す）
  let lastTick: number | null = null;
  let ms = 0;
  let timeMark = 0;
  let results = 0;
  let last: { kind: ResultKind; at: number; paired: boolean } | null = null;
  const kinds = new Set<number>();
  let grav: [number, number, number] | null = null;
  let started = false;
  const touch = (now: number) => {
    if (now > lastActive + ACTIVE_WINDOW_MS) since = now;
    lastActive = now;
    if (!started) { started = true; emit({ name: "play_time", value: 0 }); }
  };
  return {
    // 枠の中で触った・押した
    active(now: number) { touch(now); },
    // 1秒ごとと、画面に出る・隠れるが変わったときに呼ぶ。visible: 前に呼んでから今までの間、画面に出ていたか
    // その間のうち、遊んでいた（触ってから10秒以内の）分を足す
    tick(now: number, visible: boolean) {
      const prev = lastTick;
      lastTick = now;
      if (!visible || prev === null) return;
      ms += Math.max(0, Math.min(now, lastActive + ACTIVE_WINDOW_MS) - Math.max(prev, since));
      while (timeMark < PLAY_TIME_MARKS.length && ms >= PLAY_TIME_MARKS[timeMark] * 1000) emit({ name: "play_time", value: PLAY_TIME_MARKS[timeMark++] });
    },
    // ページの側がツールに渡した動き（重力を含む加速度）。持っているだけの揺れは数えず、振ったときだけ遊んでいるとみなす
    motion(now: number, x: number, y: number, z: number) {
      if (!grav) { grav = [x, y, z]; return; }
      const d = Math.hypot(x - grav[0], y - grav[1], z - grav[2]);
      grav = [grav[0] + (x - grav[0]) * 0.05, grav[1] + (y - grav[1]) * 0.05, grav[2] + (z - grav[2]) * 0.05];
      if (d > SHAKE) touch(now);
    },
    // ツールが結果を知らせた。kind: labShare（share）か labResult（result）か。index は labResult の番号
    // 遊んだ時間は延ばさない（時間で勝手に結果を出すツールで、誰も触っていないのに数えないように。PR #123 の ai-review の指摘）
    // 1回にまとめるのは、違う種類の知らせが組で続けて来たときだけ（同じ種類が続いたら別の結果。まとめた知らせで時間を延ばさない。PR #123 の ai-review の指摘）
    result(now: number, kind: ResultKind, index?: number) {
      if (last && !last.paired && last.kind !== kind && now - last.at <= SAME_RESULT_MS) last.paired = true;
      else {
        results++;
        if ((RESULT_MARKS as readonly number[]).includes(results)) emit({ name: "results", value: results });
        last = { kind, at: now, paired: false };
      }
      if (index !== undefined && !kinds.has(index)) {
        kinds.add(index);
        emit({ name: "result_kinds", value: kinds.size });
      }
    },
  };
}
