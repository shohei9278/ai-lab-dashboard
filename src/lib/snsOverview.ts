import { db, getSettings, type ProjectRow } from "./db";
import { CONV } from "./loop";
import { AUTO_PLATFORMS, type AutoPlatform } from "./snsApi";
import { postLink } from "./sns";

// SNSの管理画面用: 場所ごとの状態（つながっているか・今日の投稿数・次に投稿できる時刻・最後の失敗）と、投稿の一覧

const parseUtc = (s: string) => Date.parse(s.replace(" ", "T") + "Z");

export function accounts() {
  const s = getSettings();
  return (Object.keys(AUTO_PLATFORMS) as AutoPlatform[]).map((key) => {
    const def = AUTO_PLATFORMS[key];
    const apiId = `${key}-api`;
    const recent = db().prepare("SELECT COUNT(*) AS n, MAX(posted_at) AS last FROM sns_posts WHERE platform = ? AND status = 'posted' AND author = 'ai' AND post_url IS NOT NULL AND posted_at >= datetime('now', '-24 hours')").get(key) as { n: number; last: string | null };
    const all = db().prepare("SELECT COUNT(*) AS n, COALESCE(SUM(visits), 0) AS v, COALESCE(SUM(conversions), 0) AS c FROM sns_posts WHERE platform = ? AND status = 'posted'").get(key) as { n: number; v: number; c: number };
    const lastCall = db().prepare("SELECT at, error FROM ai_calls WHERE model_id = ? ORDER BY id DESC LIMIT 1").get(apiId) as { at: string; error: string | null } | undefined;
    const cost = (db().prepare("SELECT COALESCE(SUM(cost_usd), 0) AS c FROM ai_calls WHERE model_id = ? AND strftime('%Y-%m', at) = strftime('%Y-%m', 'now')").get(apiId) as { c: number }).c;
    // 次に投稿できる時刻（間隔・失敗のあとの待ち時間のうち、遅い方。日本時間の8〜22時の外なら翌朝8時）
    let next = Date.now();
    if (recent.last) next = Math.max(next, parseUtc(recent.last) + (14 / Math.max(1, s.autoPostPerDay)) * 3_600_000);
    if (lastCall?.error) next = Math.max(next, parseUtc(lastCall.at) + 2 * 3_600_000);
    const jstHour = (t: number) => (new Date(t).getUTCHours() + 9) % 24;
    if (jstHour(next) >= 22 || jstHour(next) < 8) {
      const d = new Date(next + 9 * 3_600_000);
      if (d.getUTCHours() >= 22) d.setUTCDate(d.getUTCDate() + 1);
      d.setUTCHours(8, 0, 0, 0);
      next = d.getTime() - 9 * 3_600_000;
    }
    const handle = key === "x" ? (s.snsAccount ? `@${s.snsAccount}` : null) : key === "bluesky" ? (process.env.BLUESKY_HANDLE ? `@${process.env.BLUESKY_HANDLE}` : null) : null;
    const profile = key === "x" ? (s.snsAccount ? `https://x.com/${s.snsAccount}` : null)
      : key === "bluesky" ? (process.env.BLUESKY_HANDLE ? `https://bsky.app/profile/${process.env.BLUESKY_HANDLE}` : null)
      : (db().prepare("SELECT post_url FROM sns_posts WHERE platform = 'threads' AND post_url IS NOT NULL ORDER BY id DESC LIMIT 1").get() as { post_url: string } | undefined)?.post_url.replace(/\/post\/.*$/, "") ?? null;
    return {
      key, label: def.label, configured: def.configured(), free: def.costUsd === 0, handle, profile,
      today: recent.n, cap: s.autoPostPerDay, nextAt: recent.n >= s.autoPostPerDay ? null : new Date(next).toISOString(),
      lastError: lastCall?.error ? { at: lastCall.at, error: lastCall.error } : null,
      costJpy: cost * s.usdJpy, posts: all.n, visits: all.v, conversions: all.c,
    };
  });
}

export type PostRow = {
  id: number; platform: string; status: string; text: string; angle: string | null; posted_at: string | null; post_url: string | null; created_at: string;
  visits: number; conversions: number; project_id: number; title: string; kind: ProjectRow["kind"]; author: string; code: string;
};

// これから投稿される下書き（自動投稿が使うもの）と、投稿済みの一覧
export function snsPosts() {
  const rows = db().prepare(
    `SELECT s.*, p.title, p.kind FROM sns_posts s JOIN projects p ON p.id = s.project_id
     WHERE s.status IN ('draft', 'posted') ORDER BY CASE s.status WHEN 'draft' THEN 0 ELSE 1 END, COALESCE(s.posted_at, s.created_at) DESC LIMIT 100`,
  ).all() as PostRow[];
  return rows.map((r) => ({ ...r, link: postLink(r.project_id, r.code), noun: CONV[r.kind].noun }));
}

// 公開中の案件ごとの、場所ごとの投稿数と、自動投稿を止めているか
export function projectSns() {
  const projects = db().prepare("SELECT * FROM projects WHERE stage = 'live' AND demo = 0 AND public_slug IS NOT NULL ORDER BY id DESC").all() as ProjectRow[];
  return projects.map((p) => {
    const by = db().prepare("SELECT platform, COUNT(*) AS n, MAX(posted_at) AS last FROM sns_posts WHERE project_id = ? AND status = 'posted' GROUP BY platform").all(p.id) as { platform: string; n: number; last: string }[];
    return { id: p.id, title: p.title, paused: !!p.sns_paused, by: Object.fromEntries(by.map((b) => [b.platform, b])) as Record<string, { n: number; last: string }> };
  });
}
