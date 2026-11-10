import Anthropic from "@anthropic-ai/sdk";
import { saveTrace } from "./traces";
import { db, getSettings, monthSpendUsd } from "./db";
import { logEvent } from "./loop";
import { isObj, isStr } from "./ai";
import { costUsd, getModel, hasKey } from "./models";

// 調べもの: 朝会のAIが「今の判断に効く、分からないこと」を1つ決め、Webの公開情報で調べる
// - 検索は数回まで。調べた結果は要約と出典（URL・ページ名・取得日）を、どの問いのために調べたかと一緒に残す
// - 他人のページの本文は写さず、要約だけにする。調べても分からなければ「分からない」のまま保留する
// - 結果は、翌朝の朝会・撤退や継続の判断・会議・アイデア出しに出典つきで渡す

export type ResearchRow = {
  id: number; at: string; plan_id: number | null; project_id: number | null; question: string; why: string | null; how: string | null;
  asked_by: string | null; status: "pending" | "running" | "answered" | "unknown" | "failed"; summary: string | null; findings: string | null;
  unknown: string | null; model_id: string | null; searches: number | null; done_at: string | null;
};
export type Finding = { point: string; url: string; title: string };

const SEARCH_USD = 0.01; // Web検索 1回あたり（$10 / 1,000回）。ページの取得は、読んだ文字の分だけ（モデルの料金）

export function addResearch(r: { planId: number; projectId: number | null; question: string; why: string; how: string; askedBy: string }): number {
  return Number(db().prepare("INSERT INTO research (plan_id, project_id, question, why, how, asked_by) VALUES (?, ?, ?, ?, ?, ?)")
    .run(r.planId, r.projectId, r.question.slice(0, 300), r.why.slice(0, 300), r.how.slice(0, 300), r.askedBy).lastInsertRowid);
}

export function listResearch(limit = 30): ResearchRow[] {
  return db().prepare("SELECT * FROM research ORDER BY id DESC LIMIT ?").all(limit) as ResearchRow[];
}

// 結果の中の、ツールが実際に返したURLを集める（AIが書いたURLのうち、本当に見たものだけを出典として残すため）
function seenUrls(content: unknown[]): Map<string, string> {
  const urls = new Map<string, string>();
  const walk = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (!v || typeof v !== "object") return;
    const o = v as Record<string, unknown>;
    if (typeof o.url === "string" && /^https?:\/\//.test(o.url)) urls.set(o.url, typeof o.title === "string" ? o.title : "");
    Object.values(o).forEach(walk);
  };
  for (const b of content) {
    const t = (b as { type?: string }).type ?? "";
    if (t.endsWith("_tool_result")) walk(b);
  }
  return urls;
}

export async function runResearch(id: number): Promise<void> {
  const r = db().prepare("SELECT * FROM research WHERE id = ?").get(id) as ResearchRow | undefined;
  if (!r || r.status !== "pending") return;
  const s = getSettings();
  if (s.killSwitch || monthSpendUsd() * s.usdJpy >= s.monthlyBudgetJpy) {
    db().prepare("UPDATE research SET status = 'failed', unknown = ?, done_at = datetime('now') WHERE id = ?").run("緊急停止中か、今月の予算の上限のため調べなかった", id);
    return;
  }
  // 調べものは、読んだページの分だけ入力が大きくなるので、安い Sonnet に任せる（Web検索の絞り込みにも対応している）
  const modelId = hasKey("anthropic") ? "claude-sonnet-5-5" : null;
  if (!modelId) return;
  db().prepare("UPDATE research SET status = 'running', model_id = ? WHERE id = ?").run(modelId, id);
  const title = r.project_id ? (db().prepare("SELECT title, target, solution, lp FROM projects WHERE id = ?").get(r.project_id) as { title: string; target: string; solution: string; lp: string | null } | undefined) : undefined;
  const lp = title?.lp ? (JSON.parse(title.lp) as { headline?: string; features?: { title: string; body: string }[] }) : null;
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date());
  const messages: Anthropic.MessageParam[] = [{
    role: "user",
    content: `次の問いについて、Webの公開情報を調べてください。
問い: ${r.question}
この問いが分かると変わる判断: ${r.why ?? ""}
調べ方の案: ${r.how ?? ""}
${title ? `問いの中の「#${r.project_id}」は自社のサービス「${title.title}」のこと。
- 対象: ${title.target}
- 中身: ${title.solution}
- ページの見出し: ${lp?.headline ?? ""}
- できること: ${lp?.features?.map((f) => `${f.title}（${f.body}）`).join(" / ") ?? ""}
比べるときは、このサービスと外のものを比べる（このサービス自体はWebで探さなくてよい）` : ""}

守ること:
- 検索は数回までに絞り、問いに必要なことだけを調べる
- 公開されているページだけを見る。ログインが要るページは見ない
- 他人のページの文章を長く写さない。分かったことは自分の言葉で短くまとめる
- 調べても分からないことは、推測で埋めずに「分からない」とする

最後に、次の形のJSONだけを書いて終える（前置き・コードブロックなし）:
{"status":"answered または unknown","summary":"分かったことのまとめ（2〜4文）","findings":[{"point":"分かったこと1つ","url":"出典のURL","title":"出典のページ名"}],"unknown":"調べても分からなかったこと（なければ空）"}`,
  }];
  const client = new Anthropic({ timeout: 10 * 60 * 1000, maxRetries: 1 });
  const model = getModel(modelId);
  let inTok = 0, outTok = 0, searches = 0;
  const all: unknown[] = [];
  let text = "";
  try {
    // 検索が長引くと「途中で一時停止」で返ってくるので、3回まで続きを頼む
    for (let i = 0; i < 4; i++) {
      const res = await client.messages.create({
        model: modelId, max_tokens: 8000, messages,
        // 検索は4回・ページの取得は2回まで（1件 約20〜40円に収めるため）
        // 結果を絞り込む新しい版（_20260209）は Sonnet だと途中で失敗することがあったので、そのまま返す版を使う
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 4 }, { type: "web_fetch_20250910", name: "web_fetch", max_uses: 2 }],
      });
      inTok += res.usage.input_tokens;
      outTok += res.usage.output_tokens;
      searches += res.usage.server_tool_use?.web_search_requests ?? 0;
      all.push(...res.content);
      text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
      if (res.stop_reason !== "pause_turn") break;
      messages.push({ role: "assistant", content: res.content });
    }
    const cost = costUsd(model, inTok, outTok) + searches * SEARCH_USD;
    db().prepare("INSERT INTO ai_calls (project_id, purpose, model_id, input_tokens, output_tokens, cost_usd, error) VALUES (?, '調べもの', ?, ?, ?, ?, NULL)").run(r.project_id, modelId, inTok, outTok, cost);
    const t = text.replace(/```(?:json)?/g, "");
    const v = JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1)) as unknown;
    if (!isObj(v)) throw new Error("結果を読み取れませんでした");
    const seen = seenUrls(all);
    // 実際に見たページのURLだけを出典として残す（見ていないURLは出典にしない）
    const findings: Finding[] = (Array.isArray(v.findings) ? v.findings : [])
      .filter((f): f is { point: string; url: string; title?: string } => isObj(f) && isStr(f.point) && isStr(f.url) && seen.has(f.url))
      .slice(0, 8).map((f) => ({ point: f.point.slice(0, 300), url: f.url, title: (isStr(f.title) ? f.title : seen.get(f.url) ?? "").slice(0, 120) }));
    const status = v.status === "answered" && findings.length ? "answered" : "unknown";
    db().prepare("UPDATE research SET status = ?, summary = ?, findings = ?, unknown = ?, searches = ?, done_at = datetime('now') WHERE id = ?")
      .run(status, isStr(v.summary) ? v.summary.slice(0, 800) : null, JSON.stringify(findings), isStr(v.unknown) ? v.unknown.slice(0, 400) : null, searches, id);
    logEvent(r.project_id, "ai", "research", `調べもの「${r.question.slice(0, 40)}」: ${status === "answered" ? `分かった（出典${findings.length}件・${today}）` : "分からなかった（保留）"}`);
    // 読み取りまで済んでから残す（失敗したときは下の catch で1件だけ残す）
    saveTrace({ purpose: "調べもの", modelId, projectId: r.project_id, system: "", input: JSON.stringify(messages[0]?.content), output: text, error: null });
  } catch (e) {
    const m = (e instanceof Error ? e.message : String(e)).slice(0, 300);
    db().prepare("INSERT INTO ai_calls (project_id, purpose, model_id, input_tokens, output_tokens, cost_usd, error) VALUES (?, '調べもの', ?, ?, ?, ?, ?)").run(r.project_id, modelId, inTok, outTok, costUsd(model, inTok, outTok) + searches * SEARCH_USD, m);
    saveTrace({ purpose: "調べもの", modelId, projectId: r.project_id, system: "", input: JSON.stringify(messages[0]?.content), output: text, error: m });
    db().prepare("UPDATE research SET status = 'failed', unknown = ?, searches = ?, done_at = datetime('now') WHERE id = ?").run(`調べる途中で失敗した: ${m}`, searches, id);
    logEvent(r.project_id, "system", "research-error", `調べもの「${r.question.slice(0, 40)}」でエラー: ${m}`);
  }
}

// AIに渡す文（直近の調べものの結果。番号付き。これを根拠に判断を変えたら research_ids で記録してもらう）
export function researchText(projectId?: number): string {
  const rows = (db().prepare(`SELECT * FROM research WHERE status IN ('answered', 'unknown') ${projectId ? "AND (project_id = ? OR project_id IS NULL)" : ""} ORDER BY id DESC LIMIT 8`)
    .all(...(projectId ? [projectId] : [])) as ResearchRow[]);
  if (!rows.length) return "";
  return `調べたこと（朝会で決めた「分からないこと」をWebの公開情報で調べた結果。出典つき。これを根拠に判断を変えたら research_ids に番号を書く）:
${rows.map((r) => {
  const f = r.findings ? (JSON.parse(r.findings) as Finding[]) : [];
  return `- 【調べもの${r.id}】${r.project_id ? `#${r.project_id} ` : ""}問い: ${r.question} → ${r.status === "answered" ? `分かった: ${r.summary ?? ""}` : "分からなかった（保留）"}${r.unknown ? ` / まだ分からない: ${r.unknown}` : ""}${f.length ? `\n  出典: ${f.map((x) => `${x.title || x.url}（${x.url}）`).join(" / ")}` : ""}`;
}).join("\n")}`;
}
