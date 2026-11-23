// 毎日の計画に渡す「今日と明日がどんな日か」: 曜日・祝日・東京の天気
// - 雨の日や休日など、家にいる人が多い日は、今ある遊ぶツールの宣伝を優先する、の判断に使う（新しく作るためではない）
// - 天気は無料・キー不要の Open-Meteo を1日1回だけ読む。読めなければ省く（曜日・祝日だけ渡す）。AIの呼び出しは増えない

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"] as const;

// "YYYY-MM-DD" の日付（日本時間の日付として扱う）
const ymd = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const parts = (day: string) => day.split("-").map(Number) as [number, number, number];
const weekday = (day: string) => { const [y, m, d] = parts(day); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };
export const addDays = (day: string, n: number) => { const [y, m, d] = parts(day); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };

// その月の第n月曜日
function nthMonday(y: number, m: number, n: number): string {
  const first = weekday(ymd(y, m, 1));
  return ymd(y, m, 1 + ((8 - first) % 7) + (n - 1) * 7);
}

// 春分・秋分の日（1980〜2099年に使える近似の式。正式には前年の官報で決まる）
const equinox = (y: number, base: number) => Math.floor(base + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));

// その年の国民の祝日（いまの祝日法の決まり。振替休日・国民の休日も入れる）
export function japaneseHolidays(y: number): Map<string, string> {
  const base: [string, string][] = [
    [ymd(y, 1, 1), "元日"],
    [nthMonday(y, 1, 2), "成人の日"],
    [ymd(y, 2, 11), "建国記念の日"],
    [ymd(y, 2, 23), "天皇誕生日"],
    [ymd(y, 3, equinox(y, 20.8431)), "春分の日"],
    [ymd(y, 4, 29), "昭和の日"],
    [ymd(y, 5, 3), "憲法記念日"],
    [ymd(y, 5, 4), "みどりの日"],
    [ymd(y, 5, 5), "こどもの日"],
    [nthMonday(y, 7, 3), "海の日"],
    [ymd(y, 8, 11), "山の日"],
    [nthMonday(y, 9, 3), "敬老の日"],
    [ymd(y, 9, equinox(y, 23.2488)), "秋分の日"],
    [nthMonday(y, 10, 2), "スポーツの日"],
    [ymd(y, 11, 3), "文化の日"],
    [ymd(y, 11, 23), "勤労感謝の日"],
  ];
  const map = new Map(base);
  // 国民の休日: 祝日にはさまれた平日
  for (const [day] of base) {
    const mid = addDays(day, 1);
    if (!map.has(mid) && map.has(addDays(day, 2)) && weekday(mid) !== 0) map.set(mid, "国民の休日");
  }
  // 振替休日: 祝日が日曜日なら、そのあとの最初の祝日でない日
  for (const [day] of [...map]) {
    if (weekday(day) !== 0) continue;
    let d = addDays(day, 1);
    while (map.has(d)) d = addDays(d, 1);
    map.set(d, "振替休日");
  }
  return map;
}

export function holidayOf(day: string): string | null {
  return japaneseHolidays(parts(day)[0]).get(day) ?? null;
}

// 曜日と、休日かどうか（例: "月・祝日: 勤労感謝の日" / "土・休日" / "火・平日"）
export function dayLabel(day: string): string {
  const w = weekday(day);
  const h = holidayOf(day);
  return `${WEEKDAYS[w]}・${h ? `祝日: ${h}` : w === 0 || w === 6 ? "休日" : "平日"}`;
}

export type DayWeather = { day: string; text: string; max: number | null; min: number | null; rain: number | null };

// WMO の天気の番号を、日本語の短い言葉に
export function weatherWord(code: number): string {
  if (code === 0) return "晴れ";
  if (code <= 2) return "晴れ時々くもり";
  if (code === 3) return "くもり";
  if (code === 45 || code === 48) return "霧";
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return "雨";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "雪";
  if (code >= 95) return "雷雨";
  return "不明";
}

// Open-Meteo の答えを読む（形が違えば空）
export function parseOpenMeteo(v: unknown): DayWeather[] {
  const daily = (v as { daily?: Record<string, unknown> } | null)?.daily;
  if (!daily || !Array.isArray(daily.time) || !Array.isArray(daily.weather_code)) return [];
  const num = (k: string, i: number) => { const a = daily[k]; const x = Array.isArray(a) ? a[i] : null; return typeof x === "number" && Number.isFinite(x) ? Math.round(x) : null; };
  return (daily.time as unknown[]).flatMap((t, i) => {
    const code = (daily.weather_code as unknown[])[i];
    if (typeof t !== "string" || typeof code !== "number") return [];
    return [{ day: t, text: weatherWord(code), max: num("temperature_2m_max", i), min: num("temperature_2m_min", i), rain: num("precipitation_probability_max", i) }];
  });
}

const OPEN_METEO = "https://api.open-meteo.com/v1/forecast?latitude=35.6895&longitude=139.6917&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=Asia%2FTokyo&forecast_days=2";

// 1日1回だけ読む（読めなかった日も、その日は読み直さない）
let cache: { day: string; weather: DayWeather[] } | null = null;

export async function tokyoWeather(today: string, get: typeof fetch = fetch): Promise<DayWeather[]> {
  if (cache?.day === today) return cache.weather;
  let weather: DayWeather[] = [];
  try {
    const res = await get(OPEN_METEO, { headers: { "User-Agent": "ai-product-lab (daily plan)" }, signal: AbortSignal.timeout(10_000) });
    if (res.ok) weather = parseOpenMeteo(await res.json());
  } catch {
    weather = [];
  }
  cache = { day: today, weather };
  return weather;
}

// 計画の材料にする文。天気がない日は、曜日・祝日だけ
export function dayContextText(today: string, weather: DayWeather[]): string {
  const line = (day: string, name: string) => {
    const w = weather.find((x) => x.day === day);
    const wt = w ? ` 東京の天気: ${w.text}${w.max !== null ? `・最高${w.max}℃` : ""}${w.min !== null ? `・最低${w.min}℃` : ""}${w.rain !== null ? `・降水確率${w.rain}%` : ""}` : "";
    return `- ${name} ${day.slice(5).replace("-", "/")}（${dayLabel(day)}）${wt}`;
  };
  return [
    `今日と明日がどんな日か${weather.length ? "（天気は Open-Meteo の予報）" : "（天気は読めなかったので省く）"}:`,
    line(today, "今日"),
    line(addDays(today, 1), "明日"),
  ].join("\n");
}

// テスト用: 天気の覚えを消す
export function resetWeatherCache(): void {
  cache = null;
}
