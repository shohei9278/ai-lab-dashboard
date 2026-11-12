import { db, getSettings, monthSpendUsd } from "./db";
import { jstToday } from "./loop";
import { waitingItems } from "./overview";
import { modelInfo } from "./models";
import type { Member, OfficeEvent, OfficeHappening, OfficeLine, Room } from "./officeShared";

// オフィスの画面（試作）: AIの社員3人が、いま何をしているかを部屋の位置で見せる
// - AIを呼んだ記録（ai_calls の目的）から、どの部屋で働いているかを決める
// - 社員の声と、提案箱に入れた提案は、吹き出しにする
// - 直近の動きがないときは、画面の側で直近24時間の動きを早送りで再生する
// 時刻はすべて UTC の "YYYY-MM-DD HH:MM:SS"

// AIを呼んだ目的から部屋を決める（作る・確かめる → 開発室、考える・決める・採点 → 会議室、発信 → 広報デスク）
export function roomOf(purpose: string): Room {
  if (/投稿|SNS|返信|日報|レポート|note|動画|反応|話題の投稿|欲しい/.test(purpose)) return "pr";
  if (/判断|議論|会議|アイデア|採点|計画|教訓|作戦|声の選別|比較（採点）/.test(purpose)) return "meeting";
  if (/LP|ツール|デザイン|イラスト|アイコン|画像|動作確認|プロンプトの比較/.test(purpose)) return "dev";
  return "meeting";
}

// 吹き出しに出す短い説明（何をしているか）
export function doingOf(purpose: string): string {
  return purpose.replace(/（.*?）/g, "").slice(0, 20);
}

// SNSのAPI（x-api など）や画像を作るモデルは、AIの社員の作業ではないので数えない（ライブの画面と同じ扱い）
const memberOf = (modelId: string | null): Member | null => {
  if (!modelId || modelId.endsWith("-api") || modelId.startsWith("gpt-image")) return null;
  const p = modelInfo(modelId).provider;
  return p === "anthropic" || p === "openai" || p === "google" ? p : null;
};

export function officeSnapshot() {
  const calls = db().prepare(
    `SELECT c.at, c.purpose, c.model_id, c.cost_usd, p.title FROM ai_calls c LEFT JOIN projects p ON p.id = c.project_id
     WHERE c.at >= datetime('now', '-1 day') AND c.error IS NULL ORDER BY c.id`,
  ).all() as { at: string; purpose: string; model_id: string; cost_usd: number; title: string | null }[];
  const usdJpy = getSettings().usdJpy;
  const events: OfficeEvent[] = calls.flatMap((c) => {
    const member = memberOf(c.model_id);
    return member ? [{ at: c.at, member, room: roomOf(c.purpose), doing: doingOf(c.purpose), project: c.title, yen: Math.round(c.cost_usd * usdJpy * 10) / 10 }] : [];
  });
  // 公開・撤退・続ける（会社全体の出来事）
  const happenings = (db().prepare(
    `SELECT e.at, e.kind, p.title FROM events e LEFT JOIN projects p ON p.id = e.project_id
     WHERE e.kind IN ('publish', 'close', 'grow') AND e.at >= datetime('now', '-1 day') AND COALESCE(p.demo, 0) = 0 ORDER BY e.id`,
  ).all() as { at: string; kind: OfficeHappening["kind"]; title: string | null }[]);
  const voices = db().prepare("SELECT at, model_id, text FROM voices WHERE at >= datetime('now', '-1 day') ORDER BY id").all() as { at: string; model_id: string | null; text: string }[];
  const proposals = db().prepare("SELECT created_at AS at, proposer, title FROM plan_requests WHERE proposer IS NOT NULL AND created_at >= datetime('now', '-1 day') ORDER BY id").all() as { at: string; proposer: string; title: string }[];
  const lines: OfficeLine[] = [
    ...voices.flatMap((v) => {
      const member = memberOf(v.model_id);
      return member ? [{ at: v.at, member, kind: "voice" as const, text: v.text.slice(0, 80) }] : [];
    }),
    ...proposals.flatMap((r) => {
      const member = memberOf(r.proposer);
      return member ? [{ at: r.at, member, kind: "proposal" as const, text: `提案があります: ${r.title}`.slice(0, 80) }] : [];
    }),
  ].sort((a, b) => a.at.localeCompare(b.at));
  return { now: new Date().toISOString().replace("T", " ").slice(0, 19), events, lines, happenings, numbers: officeNumbers() };
}

export type OfficeSnapshot = ReturnType<typeof officeSnapshot>;

// 画面の上の帯に出す、いまの数字（ホーム・ライブと同じ数え方。再生中も、いまの数字を出す）
export function officeNumbers() {
  const s = getSettings();
  const today = jstToday();
  const m = db().prepare("SELECT COALESCE(SUM(m.visits), 0) AS v, COALESCE(SUM(m.signups), 0) AS c FROM metrics m JOIN projects p ON p.id = m.project_id WHERE p.demo = 0 AND m.day = ?").get(today) as { v: number; c: number };
  // 日本時間の今日の0時（UTC の文字列）から
  const start = new Date(Date.parse(`${today}T00:00:00+09:00`)).toISOString().replace("T", " ").slice(0, 19);
  const costToday = (db().prepare("SELECT COALESCE(SUM(cost_usd), 0) AS c FROM ai_calls WHERE at >= ?").get(start) as { c: number }).c;
  const live = (db().prepare("SELECT COUNT(*) AS n FROM projects WHERE stage = 'live' AND demo = 0").get() as { n: number }).n;
  const waiting = waitingItems().filter((w) => !w.demo);
  return {
    visitsToday: m.v,
    convToday: m.c,
    costTodayJpy: Math.round(costToday * s.usdJpy),
    monthJpy: Math.round(monthSpendUsd() * s.usdJpy),
    budgetJpy: s.monthlyBudgetJpy,
    live,
    waiting: waiting.length,
    stuck: waiting.filter((w) => w.kind === "stuck").length,
  };
}
