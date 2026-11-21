// 遊びの深さ: 来た人1人あたり、どれだけ遊んだか（来た人数に左右されない、面白さの目安。運営者が決めた）
// - 遊び始めた: 枠の中で初めて触った・押した・振ったときに、遊んだ時間の 0秒 として知らせる（遊びの深さの割合の分母。PR #123 の ai-review の指摘）
// - 遊んだ時間: 枠の中で触った・押した・振ったときから10秒のあいだを「遊んでいる」として、画面に出ている秒数を足す
// - 結果を出した回数: ツールが結果を知らせた回数（labShare と labResult が続けて来ても1回。quiet の途中の結果も数える）
// - 出した結果の種類: labResult の番号の種類の数（集めるツールなら、どこまで集めたか）
// それぞれ、決まった区切り（15秒・30秒…、2回・3回…、1種類・2種類…）を超えたときに1度だけ知らせる（公開サイトの記録は、人・区切りごとに1日1件）

export const PLAY_TIME_MARKS = [15, 30, 60, 120, 300, 600] as const; // 秒
export const RESULT_MARKS = [2, 3, 5, 10] as const; // 回
export const ACTIVE_WINDOW_MS = 10_000; // 触ってから、この間は遊んでいるとみなす
const SAME_RESULT_MS = 1000; // この間に続けて来た結果の知らせは、同じ1回の結果とみなす
const SHAKE = 4; // m/s²。ならした値からこれ以上ずれた動きを、振った（遊んでいる）とみなす

export type DepthName = "play_time" | "results" | "result_kinds";
export type DepthEvent = { name: DepthName; value: number };

export function playDepth(emit: (e: DepthEvent) => void) {
  let lastActive = -Infinity;
  let seconds = 0;
  let timeMark = 0;
  let results = 0;
  let lastResult = -Infinity;
  const kinds = new Set<number>();
  let grav: [number, number, number] | null = null;
  let started = false;
  const touch = (now: number) => {
    lastActive = now;
    if (!started) { started = true; emit({ name: "play_time", value: 0 }); }
  };
  return {
    // 枠の中で触った・押した
    active(now: number) { touch(now); },
    // 1秒ごとに呼ぶ。画面に出ていて、最近触っていれば、遊んだ時間を1秒足す
    tick(now: number, visible: boolean) {
      if (!visible || now - lastActive > ACTIVE_WINDOW_MS) return;
      seconds++;
      while (timeMark < PLAY_TIME_MARKS.length && seconds >= PLAY_TIME_MARKS[timeMark]) emit({ name: "play_time", value: PLAY_TIME_MARKS[timeMark++] });
    },
    // ページの側がツールに渡した動き（重力を含む加速度）。持っているだけの揺れは数えず、振ったときだけ遊んでいるとみなす
    motion(now: number, x: number, y: number, z: number) {
      if (!grav) { grav = [x, y, z]; return; }
      const d = Math.hypot(x - grav[0], y - grav[1], z - grav[2]);
      grav = [grav[0] + (x - grav[0]) * 0.05, grav[1] + (y - grav[1]) * 0.05, grav[2] + (z - grav[2]) * 0.05];
      if (d > SHAKE) touch(now);
    },
    // ツールが結果を知らせた。index は labResult の番号（labShare だけなら undefined）
    // 遊んだ時間は延ばさない（時間で勝手に結果を出すツールで、誰も触っていないのに数えないように。PR #123 の ai-review の指摘）
    result(now: number, index?: number) {
      if (now - lastResult > SAME_RESULT_MS) {
        results++;
        if ((RESULT_MARKS as readonly number[]).includes(results)) emit({ name: "results", value: results });
      }
      lastResult = now;
      if (index !== undefined && !kinds.has(index)) {
        kinds.add(index);
        emit({ name: "result_kinds", value: kinds.size });
      }
    },
  };
}
