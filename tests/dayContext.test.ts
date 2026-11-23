import assert from "node:assert/strict";
import { test } from "node:test";
import { dayContextText, dayLabel, holidayOf, japaneseHolidays, parseOpenMeteo, resetWeatherCache, tokyoWeather } from "../src/lib/dayContext";

test("祝日: 決まった日・ハッピーマンデー・春分秋分・振替休日・国民の休日", () => {
  assert.equal(holidayOf("2026-11-23"), "勤労感謝の日");
  assert.equal(holidayOf("2026-01-12"), "成人の日");
  assert.equal(holidayOf("2026-03-20"), "春分の日");
  assert.equal(holidayOf("2026-09-23"), "秋分の日");
  assert.equal(holidayOf("2026-09-22"), "国民の休日"); // 敬老の日(9/21)と秋分の日(9/23)にはさまれる
  assert.equal(holidayOf("2026-05-06"), "振替休日"); // 5/3 が日曜日
  assert.equal(holidayOf("2027-02-23"), "天皇誕生日");
  assert.equal(holidayOf("2026-11-24"), null);
  assert.equal(japaneseHolidays(2026).size, 18);
});

test("曜日: 祝日・土日・平日を分ける", () => {
  assert.equal(dayLabel("2026-11-23"), "月・祝日: 勤労感謝の日");
  assert.equal(dayLabel("2026-11-28"), "土・休日");
  assert.equal(dayLabel("2026-11-24"), "火・平日");
});

const sample = {
  daily: {
    time: ["2026-11-23", "2026-11-24"],
    weather_code: [61, 1],
    temperature_2m_max: [12.4, 16.6],
    temperature_2m_min: [6.1, 7],
    precipitation_probability_max: [80, 10],
  },
};

test("天気: Open-Meteo の答えを読み、形が違えば空にする", () => {
  assert.deepEqual(parseOpenMeteo(sample), [
    { day: "2026-11-23", text: "雨", max: 12, min: 6, rain: 80 },
    { day: "2026-11-24", text: "晴れ時々くもり", max: 17, min: 7, rain: 10 },
  ]);
  assert.deepEqual(parseOpenMeteo({ error: true }), []);
  assert.deepEqual(parseOpenMeteo(null), []);
});

test("天気: 1日1回だけ読み、読めなかった日も読み直さない", async () => {
  resetWeatherCache();
  let calls = 0;
  const ok = (async () => { calls++; return new Response(JSON.stringify(sample)); }) as typeof fetch;
  assert.equal((await tokyoWeather("2026-11-23", ok)).length, 2);
  assert.equal((await tokyoWeather("2026-11-23", ok)).length, 2);
  assert.equal(calls, 1);
  const fail = (async () => { calls++; throw new Error("network"); }) as typeof fetch;
  assert.deepEqual(await tokyoWeather("2026-11-24", fail), []);
  assert.deepEqual(await tokyoWeather("2026-11-24", fail), []);
  assert.equal(calls, 2);
  resetWeatherCache();
});

test("材料の文: 天気があれば足し、なければ曜日・祝日だけ", () => {
  const w = parseOpenMeteo(sample);
  const t = dayContextText("2026-11-23", w);
  assert.match(t, /今日 11\/23（月・祝日: 勤労感謝の日） 東京の天気: 雨・最高12℃・最低6℃・降水確率80%/);
  assert.match(t, /明日 11\/24（火・平日） 東京の天気: 晴れ時々くもり/);
  const n = dayContextText("2026-11-28", []);
  assert.match(n, /天気は読めなかったので省く/);
  assert.match(n, /今日 11\/28（土・休日）$/m);
  assert.match(n, /明日 11\/29（日・休日）$/m);
});
