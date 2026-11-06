import { db, getSettings } from "./db";
import { MODELS, hasKey, type ModelDef } from "./models";
import { PAGE_RIVALS, TOOL_MODELS, ideaAuthors, shadowModels } from "./loop";
import { PAGE_JUDGES } from "./freePage";
import { PLAN_MODELS } from "./plan";
import type { Ranking } from "./experiment";

// 社員名簿: モデルを「社員」として、担当している仕事・仕事の量・部門ごとの順位をまとめる（新しくAIは呼ばない）

export type Staff = {
  model: ModelDef;
  roles: string[];
  calls: number;
  costJpy: number;
  ranks: { title: string; place: number; of: number; display: string }[];
  strong: string[]; // 1位の部門
  weak: string[]; // 最下位の部門（3社以上で比べた部門だけ）
};

function rolesOf(id: string): string[] {
  const s = getSettings();
  const r: string[] = [];
  if (id === s.loopModel) r.push("製品ループの担当（LPの文章・判断など）");
  if (ideaAuthors().includes(id)) r.push("アイデア出しと採点", "文章と構成の候補と採点");
  if (id.startsWith("claude") && MODELS.find((m) => m.id === id)?.tier === "top") r.push("ページのデザイン");
  if (PAGE_RIVALS.includes(id)) r.push("ページのデザイン（作り比べ）");
  if (PAGE_JUDGES.includes(id)) r.push("デザインの採点");
  if (TOOL_MODELS.includes(id)) r.push("ツールのコード");
  if (PLAN_MODELS.includes(id)) r.push("朝会の担当（日替わり）・定例会議");
  if (shadowModels().includes(id)) r.push("判断の会議");
  if (id === "claude-haiku-5-5") r.push("投稿の分類などの軽い作業");
  return [...new Set(r)];
}

export function staffList(list: Ranking[]): Staff[] {
  const s = getSettings();
  const work = new Map((db().prepare("SELECT model_id AS m, COUNT(*) AS n, SUM(cost_usd) AS usd FROM ai_calls WHERE error IS NULL GROUP BY model_id").all() as { m: string; n: number; usd: number }[]).map((r) => [r.m, r]));
  return MODELS.filter((m) => hasKey(m.provider) || work.has(m.id))
    .map((m) => {
      const ranks = list.filter((r) => r.rows.length > 1).flatMap((r) => {
        const i = r.rows.findIndex((x) => x.modelId === m.id);
        return i < 0 ? [] : [{ title: r.title, place: i + 1, of: r.rows.length, display: r.rows[i].display }];
      });
      const w = work.get(m.id);
      return {
        model: m, roles: rolesOf(m.id), calls: w?.n ?? 0, costJpy: (w?.usd ?? 0) * s.usdJpy, ranks,
        strong: ranks.filter((r) => r.place === 1).map((r) => r.title),
        weak: ranks.filter((r) => r.of >= 3 && r.place === r.of).map((r) => r.title),
      };
    })
    .filter((x) => x.roles.length || x.calls)
    .sort((a, b) => b.calls - a.calls);
}
