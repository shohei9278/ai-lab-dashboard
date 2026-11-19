import { callJson, isObj } from "./ai";
import { db, type ProjectRow } from "./db";
import { hasKey } from "./models";
import { SITE_CATEGORIES, SITE_CATEGORY_KEYS, isSiteCategory, type SiteCategory } from "../../lp-site/src/lp/categories";

// 公開サイト（Hitoride）の一覧で、ツールに付けるカテゴリ（診断・占い、計算・見積もり など。lp-site の categories.ts）
// - 公開するときに、軽いAIがツールの名前と中身から1つ選ぶ（site_category_auto）。合うものがなければ付けない（一覧では「そのほか」）
// - 運営者が案件の画面で選んだもの（site_category）があれば、そちらを使う
// - アイデア出しには使わない（決まった一覧を見せると、アイデアの幅が狭まるため）
export { SITE_CATEGORIES, isSiteCategory, type SiteCategory };

export function siteCategoryOf(p: Pick<ProjectRow, "site_category" | "site_category_auto">): SiteCategory | null {
  if (isSiteCategory(p.site_category)) return p.site_category;
  return isSiteCategory(p.site_category_auto) ? p.site_category_auto : null;
}

// AIの答え（{"category":"calc"} または {"category":null}）を読む。一覧にないものは「合うものがない」とする
export function parseCategoryAnswer(v: unknown): SiteCategory | null {
  return isObj(v) && isSiteCategory(v.category) ? v.category : null;
}

// 判定している途中の案件（同じ案件の判定が同時に頼まれたら、走っている判定の結果を待つ。AIを2回呼ばない。サーバーは1台なので、このプロセスの中だけで足りる）
const g = globalThis as unknown as { __aiLabCategoryJobs?: Map<number, Promise<SiteCategory | null>> };
const jobs = (g.__aiLabCategoryJobs ??= new Map());

// 動くツールの案件に、まだAIの判定がなければ、軽いAIに選ばせて残す（1回 約0.1円）。選んだもの（なければ null）を返す
// 失敗したら投げる（公開するときは呼ぶ側で受け流す）
export function classifySiteCategory(p: ProjectRow): Promise<SiteCategory | null> {
  if (p.kind !== "tool" || p.site_category_auto) return Promise.resolve(isSiteCategory(p.site_category_auto) ? p.site_category_auto : null);
  const running = jobs.get(p.id);
  if (running) return running;
  const job = classifyNow(p).finally(() => jobs.delete(p.id));
  jobs.set(p.id, job);
  return job;
}

async function classifyNow(p: ProjectRow): Promise<SiteCategory | null> {
  const list = SITE_CATEGORY_KEYS.map((k) => `- ${k}: ${SITE_CATEGORIES[k].label}（${SITE_CATEGORIES[k].hint}）`).join("\n");
  const answer = await callJson<{ category: string | null }>({
    purpose: "公開サイトのカテゴリ分け",
    projectId: p.id,
    modelId: hasKey("anthropic") ? "claude-haiku-5-5" : undefined,
    system: `あなたは、小さなWebツールの一覧サイトで、ツールをカテゴリに分ける担当です。来た人が探すときに、いちばん自然なカテゴリを1つ選びます。
カテゴリ:
${list}
どれにもはっきり合わないときは null にする（無理に当てはめない）。
形式: {"category":"カテゴリのキー または null"}`,
    user: `ツール名: ${p.title}\n何ができるか: ${p.solution}`,
    validate: (v): v is { category: string | null } => isObj(v) && (v.category === null || typeof v.category === "string"),
  });
  const cat = parseCategoryAnswer(answer);
  // 合うものがなかったときも「判定した」と分かるように残す（毎回AIを呼ばない）
  db().prepare("UPDATE projects SET site_category_auto = ? WHERE id = ?").run(cat ?? "none", p.id);
  return cat;
}
