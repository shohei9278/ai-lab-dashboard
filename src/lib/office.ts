import { db, getSettings, monthSpendUsd } from "./db";
import { jstToday } from "./loop";
import { waitingItems } from "./overview";
import { openRequests } from "./plan";
import { pendingCount } from "./views";
import { modelInfo } from "./models";
import { liveFeed } from "./live";
import { showcaseProjectRows } from "./showcase";
import type { Member, OfficeEvent, OfficeHappening, OfficeLine, OfficeShop, Room } from "./officeShared";

// オフィスの画面（試作）: AIの社員3人が、いま何をしているかを部屋の位置で見せる
// - AIを呼んだ記録（ai_calls の目的）から、どの部屋で働いているかを決める
// - 社員の声、提案箱に入れた提案、ライブの「AIの会話」（提案・採点・判断・議論）は、吹き出しにする
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

const isMember = (p: string | null): p is Member => p === "anthropic" || p === "openai" || p === "google";
const plusSeconds = (at: string, s: number) => new Date(Date.parse(at.replace(" ", "T") + "Z") + s * 1000).toISOString().replace("T", " ").slice(0, 19);
export const TALK_GAP_SECONDS = 20;

// ライブの「AIの会話」を、話した社員の吹き出しにする（社員でない話し手＝SNSの投稿・コメント・返信の案は出さない）
// 採点などは同じ時刻に何件も書かれるので、同じ社員・同じ時刻のものは20秒ずつずらして、順に吹き出しに出す
export function officeTalks({ guest = false } = {}): OfficeLine[] {
  const since = plusSeconds(new Date().toISOString().replace("T", " ").slice(0, 19), -86_400);
  // つぶやきと提案箱への提案は、オフィスでは別に取って吹き出しに出しているので、ここでは除く（二重にしない）
  const items = liveFeed({ guest })
    .filter((f) => isMember(f.provider) && f.at.replace("T", " ") >= since && !f.kind.startsWith("つぶやき（") && f.kind !== "提案箱に提案")
    .reverse();
  const seen = new Map<string, number>();
  return items.map((f) => {
    const at = f.at.replace("T", " ").slice(0, 19);
    const key = `${f.provider}|${at}`;
    const k = seen.get(key) ?? 0;
    seen.set(key, k + 1);
    return { at: plusSeconds(at, k * TALK_GAP_SECONDS), member: f.provider as Member, kind: "talk" as const, about: f.kind, text: f.text.slice(0, 400), project: f.project };
  });
}

// 発言から作る動きの短い言い方（発言の見出しは「「案件名」を採点」のように長いので、何をしているかだけにする）
export function talkDoing(about: string): string {
  if (about.startsWith("臨時会議")) return "臨時会議";
  if (/採点/.test(about)) return "採点";
  if (/アイデア/.test(about)) return "アイデア出し";
  if (/議論/.test(about)) return "判断の議論";
  if (/判断/.test(about)) return "判断";
  return doingOf(about);
}

// guest: 来た人の画面か（AIの会話の伏せ方をライブ画面とそろえる）
export function officeSnapshot({ guest = false } = {}) {
  const calls = db().prepare(
    `SELECT c.at, c.purpose, c.model_id, c.cost_usd, c.project_id, p.title FROM ai_calls c LEFT JOIN projects p ON p.id = c.project_id
     WHERE c.at >= datetime('now', '-1 day') AND c.error IS NULL ORDER BY c.id`,
  ).all() as { at: string; purpose: string; model_id: string; cost_usd: number; project_id: number | null; title: string | null }[];
  const usdJpy = getSettings().usdJpy;
  const events: OfficeEvent[] = calls.flatMap((c) => {
    const member = memberOf(c.model_id);
    return member ? [{ at: c.at, member, room: roomOf(c.purpose), doing: doingOf(c.purpose), project: c.title, projectId: c.project_id, yen: Math.round(c.cost_usd * usdJpy * 10) / 10 }] : [];
  });
  // 公開・撤退・続ける（会社全体の出来事）
  const happenings = (db().prepare(
    `SELECT e.at, e.kind, p.title FROM events e LEFT JOIN projects p ON p.id = e.project_id
     WHERE e.kind IN ('publish', 'close', 'grow') AND e.at >= datetime('now', '-1 day') AND COALESCE(p.demo, 0) = 0 ORDER BY e.id`,
  ).all() as { at: string; kind: OfficeHappening["kind"]; title: string | null }[]);
  const voices = db().prepare("SELECT at, model_id, text FROM voices WHERE at >= datetime('now', '-1 day') ORDER BY id").all() as { at: string; model_id: string | null; text: string }[];
  const proposals = db().prepare("SELECT created_at AS at, proposer, title FROM plan_requests WHERE proposer IS NOT NULL AND created_at >= datetime('now', '-1 day') ORDER BY id").all() as { at: string; proposer: string; title: string }[];
  const talks = officeTalks({ guest });
  // 話している社員は、その発言に合う部屋にいる（AIを呼んだ時刻と、発言の時刻は少しずれるため）
  events.push(...talks.map((l) => ({ at: l.at, member: l.member, room: roomOf(l.about ?? ""), doing: talkDoing(l.about ?? ""), project: l.project ?? null, projectId: null, yen: 0, talk: true })));
  events.sort((a, b) => a.at.localeCompare(b.at));
  const lines: OfficeLine[] = [
    ...voices.flatMap((v) => {
      const member = memberOf(v.model_id);
      return member ? [{ at: v.at, member, kind: "voice" as const, text: v.text.slice(0, 80) }] : [];
    }),
    ...proposals.flatMap((r) => {
      const member = memberOf(r.proposer);
      return member ? [{ at: r.at, member, kind: "proposal" as const, text: `提案があります: ${r.title}`.slice(0, 80) }] : [];
    }),
    ...talks,
  ].sort((a, b) => a.at.localeCompare(b.at));
  return { now: new Date().toISOString().replace("T", " ").slice(0, 19), events, lines, happenings, numbers: officeNumbers(), shops: officeShops() };
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
    // 動いていないときのお知らせ用: 判断待ち、提案箱の返事待ち（AIからの提案）、毎日の自動実行の時刻
    approvals: pendingCount(),
    proposals: openRequests().filter((r) => r.source !== "human").length,
    dailyHour: s.dailyEnabled && !s.killSwitch ? s.dailyHour : null,
    killSwitch: s.killSwitch,
  };
}

// 案件の展示: 公開中・保留・育てる段階の案件と、7日以内に撤退した案件（今日の訪問が多い順。撤退した案件は最後）。今日の訪問と登録・利用も付ける
// 案件は増えていくので、画面ではすべてを絵に並べず、数と上位だけを見せる
export function officeShops(): OfficeShop[] {
  const today = jstToday();
  const rows = db().prepare(
    `SELECT p.id, p.title, p.kind, p.stage, p.growth_phase,
       COALESCE((SELECT SUM(m.visits) FROM metrics m WHERE m.project_id = p.id AND m.day = ?), 0) AS v,
       COALESCE((SELECT SUM(m.signups) FROM metrics m WHERE m.project_id = p.id AND m.day = ?), 0) AS c
     FROM projects p
     WHERE p.demo = 0 AND p.published_at IS NOT NULL
       AND (p.stage IN ('live', 'hold', 'deciding') OR (p.stage = 'killed' AND p.updated_at >= datetime('now', '-7 days')))
     ORDER BY (p.stage = 'killed'), v DESC, p.id DESC LIMIT 50`,
  ).all(today, today) as { id: number; title: string; kind: string; stage: string; growth_phase: number; v: number; c: number }[];
  return rows.map((r) => ({
    id: r.id, title: r.title, kind: r.kind === "tool" ? "tool" : "lp",
    status: r.stage === "killed" ? "closed" : r.stage === "hold" ? "hold" : r.growth_phase ? "growing" : "open",
    visitsToday: r.v, convToday: r.c,
  }));
}

// 概要ページ（/showcase、パスワードなしで開ける）のオフィス。来訪者が見るだけなので、運営の中身は渡さない
// - 吹き出しは、設定で載せると決めた社員の声だけ。AIの会話（提案・採点・判断・議論）と提案箱の提案の中身は出さない
// - 案件の名前は、公開した・終わった実案件のものだけ（まだ公開していない案件の名前は伏せる）
// - 判断待ち・提案箱・確認待ち・予算の数字は出さない
export function showcaseOfficeSnapshot() {
  const s = getSettings();
  const snap = officeSnapshot({ guest: true });
  const open = showcaseProjectRows();
  const ids = new Set(open.map((p) => p.id));
  const titles = new Set(open.map((p) => p.title));
  const shown = (e: OfficeEvent) => (e.projectId !== null ? ids.has(e.projectId) : !!e.project && titles.has(e.project));
  return {
    ...snap,
    // 会話から作った動きの言い方に案件名（「〜」）が残るときは、まとめた言い方にする
    events: snap.events.map((e) => ({ ...e, doing: e.doing.includes("「") ? "話し合い" : e.doing, ...(shown(e) ? {} : { project: null, projectId: null }) })),
    lines: s.showcaseVoices ? snap.lines.filter((l) => l.kind === "voice") : [],
    happenings: snap.happenings.filter((h) => !!h.title && titles.has(h.title)),
    shops: snap.shops.filter((x) => ids.has(x.id)),
    numbers: { ...snap.numbers, monthJpy: 0, budgetJpy: 0, waiting: 0, stuck: 0, approvals: 0, proposals: 0 },
  };
}
