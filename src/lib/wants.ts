import { apiWishSummary } from "./apiWishes";
import { db, getSettings } from "./db";
import { logEvent, withActivity } from "./loop";
import { NEED_KINDS, needsOf, type NeedKind } from "./needs";
import { addResearch, runResearch } from "./research";

// 欲しい仕組み（運営者が決めた）: アイデアが「要る」（needs）「使いたい」（api_wish）と書いたものを数え、
// 同じものが何度も出たら、使えるサービスを具体的に調べ、定例会議の材料に渡す。
// 会議のAIは、それを根拠に「このサービスを契約・用意してほしい」を運営者に頼める。運営者は、契約して、言われたものを入れるだけにする
// - 数えるのは、直近 WANT_DAYS 日のアイデアの候補（案件にならなかった案・人の作業待ちが上限で捨てた案も数える。何がどれだけ欲しいかを少なく見せないため）
// - 調べものは、同じ欲しいものに WANT_DAYS 日に1回、全体でも WANT_RESEARCH_EVERY_DAYS 日に1回まで（費用を抑える。緊急停止と予算の上限は research.ts が見る）
// - API キーなどの値は、ダッシュボードの画面には入れない（Railway の変数に入れる。CLAUDE.md の決まり）。お願いには、変数の名前と値の取り方だけを書かせる
// - 契約したあと、ツールからつなぐ部分（共有の保存の場所・外部の API の中継）は、まだ作っていない（運営者が後回しにした）

export const WANT_DAYS = 30;
export const WANT_RESEARCH_MIN = 3; // この件数の案が欲しがったら調べる
export const WANT_RESEARCH_EVERY_DAYS = 7;

export type Want = { key: string; label: string; count: number; examples: string[]; detail: string };

// 調べものの問いに付ける印（同じ欲しいものを何度も調べないため）
const MARK_HEAD = "（欲しい仕組みの調べもの: ";
const mark = (key: string) => `${MARK_HEAD}${key}）`;
// 「最近調べたか」を見るときに、同じものとみなす印
// 「要る仕組み: 外部のAPI」と「使いたいAPI『○○』」は、同じ案が両方に書くことが多いので、互いに同じものとみなす（同じ需要を2回調べない。PR #194 の ai-review の指摘）
// 使いたいAPIどうし（名前が違うもの）は、別のものとして調べる
const sameMarks = (key: string): string[] => key === "need:api" ? [mark(key), `${MARK_HEAD}api:`] : key.startsWith("api:") ? [mark(key), mark("need:api")] : [mark(key)];

export function wants(days = WANT_DAYS): Want[] {
  const rows = db().prepare("SELECT title, payload FROM idea_candidates WHERE practice = 0 AND at >= datetime('now', ?) ORDER BY id")
    .all(`-${days} days`) as { title: string; payload: string }[];
  const by = new Map<NeedKind, { count: number; examples: string[]; whats: string[] }>();
  for (const r of rows) {
    let needs: ReturnType<typeof needsOf> = [];
    try { needs = needsOf((JSON.parse(r.payload) as { needs?: unknown }).needs); } catch { continue; }
    // 同じ案の中で同じ種類が2つあっても、案の数で数える
    for (const kind of new Set(needs.map((n) => n.kind))) {
      if (NEED_KINDS[kind].ready) continue; // 素材・そのほかは、人が用意できるので数えない
      const w = by.get(kind) ?? { count: 0, examples: [], whats: [] };
      w.count++;
      if (w.examples.length < 3) w.examples.push(r.title);
      const what = needs.find((n) => n.kind === kind)?.what;
      if (what && w.whats.length < 3 && !w.whats.includes(what)) w.whats.push(what);
      by.set(kind, w);
    }
  }
  const needWants: Want[] = [...by].map(([kind, w]) => ({
    key: `need:${kind}`, label: `${NEED_KINDS[kind].label}（${NEED_KINDS[kind].hint}）`, count: w.count, examples: w.examples,
    detail: w.whats.length ? `欲しかったもの: ${w.whats.join(" / ")}` : "",
  }));
  const apiWants: Want[] = apiWishSummary(days).map((a) => ({
    key: `api:${a.name.toLowerCase().replace(/\s+/g, " ")}`, label: `使いたいAPI「${a.name}」`, count: a.count, examples: [],
    detail: [a.purposes.length ? `用途: ${a.purposes.join(" / ")}` : "", `鍵: ${a.key ? "要る" : "要らない"}`, a.sends.length ? `送る情報: ${a.sends.join(" / ")}` : ""].filter(Boolean).join("・"),
  }));
  return [...needWants, ...apiWants].sort((a, b) => b.count - a.count);
}

// 調べものの問い（今の運営の前提も渡す。すでに契約しているもので足りるかも確かめさせる）
function question(w: Want): { question: string; why: string; how: string } {
  return {
    question: `${w.label}を、小さな公開サイトのツールから使うには、どのサービスがよいか。候補を2〜3個比べる${mark(w.key)}`,
    why: `直近${WANT_DAYS}日のアイデアのうち${w.count}件が欲しがった（例: ${w.examples.map((t) => `「${t}」`).join("・") || "—"}${w.detail ? `。${w.detail}` : ""}）。運営者に契約や用意を頼むかの判断に使う`,
    how: "それぞれの料金と無料枠・日本から使えるか・規約で気をつける所（来た人の書き込みや情報を預かってよいか）・来た人のどんな情報を送ることになるか・契約したあとに入れるもの（APIキーなど。値は書かない）と、その取り方を調べる。公開サイトは Next.js（Vercel）で、データベースは Supabase をすでに使っている。AI は Claude・GPT・Gemini の API をすでに契約している。追加の契約なしで、今あるもので足りるかも確かめる",
  };
}

type Run = (id: number) => Promise<void>;
const defaultRun: Run = (id) => withActivity({ key: `research-${id}`, title: "調べもの（欲しい仕組み）", models: ["claude-sonnet-5-5"], room: "meeting", doing: "調べもの", projectId: null }, () => runResearch(id));

// 同じものが WANT_RESEARCH_MIN 件以上の案で欲しがられていたら、使えるサービスを調べる（見回りから呼ぶ。立てたら調べものの番号を返す）
export function maybeResearchWants(opts: { run?: Run } = {}): number | null {
  const s = getSettings();
  if (s.killSwitch) return null;
  // 印は文字のまま探す（API の名前の _ や % を LIKE の記号として扱わない。PR #194 の ai-review の指摘）
  const recent = (marks: string[], days: number) => marks.some((m) => !!db().prepare("SELECT 1 FROM research WHERE instr(question, ?) > 0 AND at >= datetime('now', ?)").get(m, `-${days} days`));
  if (recent([MARK_HEAD], WANT_RESEARCH_EVERY_DAYS)) return null;
  const w = wants().find((x) => x.count >= WANT_RESEARCH_MIN && !recent(sameMarks(x.key), WANT_DAYS));
  if (!w) return null;
  const q = question(w);
  const id = addResearch({ planId: null, projectId: null, question: q.question, why: q.why, how: q.how, askedBy: "system" });
  logEvent(null, "system", "want-research", `アイデアの${w.count}件が欲しがった${w.label}に使えるサービスを調べます`);
  void (opts.run ?? defaultRun)(id).catch((e) => console.error("欲しい仕組みの調べものに失敗しました", e));
  return id;
}

// 定例会議の材料（weekly.ts の meetingMaterial）
export function wantsText(): string {
  const list = wants();
  if (!list.length) return `欲しい仕組み（直近${WANT_DAYS}日のアイデアが「要る」「使いたい」と書いたもの）: なし`;
  return `欲しい仕組み（直近${WANT_DAYS}日のアイデアが「要る」「使いたい」と書いたもの。案件にならなかった案も数える。${WANT_RESEARCH_MIN}件以上になったものは、使えるサービスを調べる候補になる。調べるのは週に1回までなので、まだ調べていないものもある。調べ終わったものは「調べたこと」に入る）:
${list.slice(0, 8).map((w) => `- ${w.label}: ${w.count}件${w.examples.length ? `（例: ${w.examples.map((t) => `「${t}」`).join("・")}）` : ""}${w.detail ? `・${w.detail}` : ""}`).join("\n")}
何度も出ていて、「調べたこと」に調べ終わった結果があるものだけ、運営者に契約や用意を頼んでよい（target は human。まだ調べていないものは頼まない）。how に、どのサービスか・月の費用・何が作れるようになるか（どの案が待っているか）・来た人のどんな情報を送るか・やめる条件・契約したら入れるもの（Railway の変数の名前と、値の取り方。値そのものは書かない）を書く。今あるもの（Supabase・契約済みのAI）で足りるなら、契約は頼まない`;
}
