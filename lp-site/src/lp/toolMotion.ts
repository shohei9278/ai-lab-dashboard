// スマホの動き（振る・傾ける）を、公開ページの側で受け取って枠の中のツールに渡す（window.labMotion）
// 運営者の依頼（#72）: iPhone では、隔離された枠（別のサイト扱い）の中から動きのセンサーの許可を求めると、画面を出さずに断られる
// （「センサーが許可されませんでした」）。そこで、許可はページの側で求め、受け取った動きの知らせを枠に渡す
// - 枠の中: window.labMotion.request() で許可を頼み（"granted"・"denied"・"unavailable"）、"labmotion" イベントで動きを受け取る
// - ページの側（ToolFrame）: 許可が要らない端末（Android など）はすぐ渡す。iPhone など許可が要る端末は、まず求めてみて、
//   断られたら枠の上に「センサーを使う」ボタンを出す（ページの側でのタップでないと、iPhone は許可の画面を出さない）
// - 許可が出ても、動きの知らせが実際に届くまでは「使える」と答えない（PC の Chrome など、仕組みはあってもセンサーのない端末がある）
// - ツールが続けて何度頼んでも、許可を求めるのは1回だけにし、待っている頼みのすべてに同じ答えを返す（motionGate）
// 外部のライブラリを読み込まない（枠の中とページの両方の決まりをここにまとめる）

export type MotionState = "granted" | "denied" | "unavailable";
type MotionApi = { requestPermission?: () => Promise<string> } | undefined;

// どう許可を取るか: none（センサーがない）・direct（許可が要らない）・ask（許可を求める）
export function motionPath(api: MotionApi): "none" | "direct" | "ask" {
  if (!api) return "none";
  return typeof api.requestPermission === "function" ? "ask" : "direct";
}

// 許可を求めた結果を、枠に返す形にする（"granted" 以外は断られた扱い）
export const motionStateOf = (r: unknown): MotionState => (r === "granted" ? "granted" : "denied");

// 動きの知らせ（重力を含む加速度 m/s²）を、枠に渡す形にする。値がない知らせは渡さない
export function motionMessage(a: { x: number | null; y: number | null; z: number | null } | null | undefined): { __lab: "motion"; x: number; y: number; z: number } | null {
  if (!a || typeof a.x !== "number" || typeof a.y !== "number") return null;
  const r = (v: number) => Math.round(v * 100) / 100;
  return { __lab: "motion", x: r(a.x), y: r(a.y), z: r(typeof a.z === "number" ? a.z : 0) };
}

type Accel = { x: number | null; y: number | null; z: number | null } | null | undefined;
export type MotionGateDeps = {
  api: () => MotionApi; // window.DeviceMotionEvent
  listen: (on: (a: Accel) => void) => () => void; // devicemotion を聞き始め、やめる関数を返す
  send: (m: { __lab: "motion"; x: number; y: number; z: number }) => void; // 枠へ動きを渡す
  reply: (id: number, state: MotionState) => void; // 枠へ許可の結果を返す
  showButton: (show: boolean) => void; // 「センサーを使う」ボタンを出す・消す
  wait?: number; // 最初の動きの知らせを待つ時間（ms）
};

// ページの側の、動きのセンサーの窓口。request（枠からの頼み）・tap（ボタン）・decline（使わない）・dispose（片付け）
// 決まった答え（granted・unavailable）は覚えておき、次の頼みにはすぐ返す。denied は覚えない（ツールが頼み直せば、またボタンを出す）
export function motionGate(d: MotionGateDeps) {
  let decided: "granted" | "unavailable" | null = null;
  let busy = false;
  let pending: number[] = [];
  let stop: (() => void) | null = null;
  const finish = (s: MotionState) => {
    busy = false;
    d.showButton(false);
    if (s !== "denied") decided = s;
    const ids = pending;
    pending = [];
    ids.forEach((id) => d.reply(id, s));
  };
  // 動きの知らせを聞き始め、値のある知らせが届いたら granted。待っても届かなければ、聞くのをやめて unavailable
  const probe = () => {
    let got = false;
    let timer: ReturnType<typeof setTimeout> | undefined = undefined;
    stop = d.listen((a) => {
      const m = motionMessage(a);
      if (!m) return;
      d.send(m);
      if (!got) { got = true; clearTimeout(timer); finish("granted"); }
    });
    timer = setTimeout(() => { if (got) return; stop?.(); stop = null; finish("unavailable"); }, d.wait ?? 1500);
  };
  return {
    request(id: number) {
      if (decided) { d.reply(id, decided); return; }
      pending.push(id);
      if (busy) return;
      busy = true;
      const api = d.api(), path = motionPath(api);
      if (path === "none") { finish("unavailable"); return; }
      if (path === "direct") { probe(); return; }
      // iPhone など: まず求めてみて、断られたら（タップがないと断られる）ボタンを出して待つ
      api!.requestPermission!().then((r) => (motionStateOf(r) === "granted" ? probe() : d.showButton(true)), () => d.showButton(true));
    },
    async tap() {
      d.showButton(false);
      let s: MotionState = "denied";
      try { s = motionStateOf(await d.api()?.requestPermission?.()); } catch { s = "denied"; }
      if (s === "granted") probe(); else finish("denied");
    },
    decline() { finish("denied"); },
    dispose() { stop?.(); stop = null; },
  };
}
