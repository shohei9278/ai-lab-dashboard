import { callJson, isObj } from "./ai";
import { db } from "./db";
import { currentModelId } from "./models";
import { logEvent } from "./loop";
import { SCORE_RULES, adjustScores, members, scoringExisting } from "./weekly";

// 朝会の仮の採点（運営者が決めた）
// 点のない提案は、月曜の定例会議で採点されるまで自動の依頼の対象に入らず、最長で1週間近く待っていた。重要そうなものは早く直したい。
// - 毎朝の朝会（plan.ts の createPlan）のあとに、まだ点のない返事待ちの提案を、3社が作者を伏せて採点し、仮の点を付ける（score_provisional = 1）
// - 仮の点で7点以上なら、月曜を待たずに自動の依頼の対象にする（autoAsk.ts）。5点未満でも、仮の点では見送りにしない（件数が少ないと点がぶれるため）
// - 月曜の定例会議で、1週間分をまとめて採点し直し、正式な点にする（採点者ごとの甘さ・辛さをならす・同じ提案をまとめる・5点未満を見送る）
// 採点するものは、定例会議と同じ決まり（weekly.ts の scoringExisting。運営者の提案・コードの見直しの守り・Claude Code に頼んだものは採点しない）
export const PROVISIONAL_MAX = 20; // 1回の朝会で採点する数（古い順）
// 仮の点にするのに要る採点の数。1社だけの点で決めない（失敗した社があれば、足りない提案は次の朝会でまた採点する）。
// 3社全部を条件にすると、1社の不調で何日も採点されなくなるので2社にした（PR #183 の ai-review の指摘）
export const PROVISIONAL_MIN_SCORERS = 2;

type Ask = typeof callJson;

// 入った日時の古い順（同じ日時なら番号順）。PR #183 の ai-review の指摘
export const unscoredProposals = () => scoringExisting().filter((r) => r.score === null).sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id - b.id).slice(0, PROVISIONAL_MAX);

export async function scoreProvisional({ material, ask = callJson }: { material: string; ask?: Ask }): Promise<{ scored: number; high: number }> {
  const rows = unscoredProposals();
  const list = members();
  if (!rows.length || list.length < PROVISIONAL_MIN_SCORERS) return { scored: 0, high: 0 };
  const order = rows.map((_, i) => i).sort(() => Math.random() - 0.5);
  const label = (i: number) => `P${order.indexOf(i) + 1}`;
  const got = await Promise.allSettled(list.map((modelId) => {
    // 自分が出した提案は採点しない（作者は伏せてあるが、自分の案をひいきしないように）。一覧から外した前のモデルが出した提案も、同じ会社の代わりのモデルは採点しない（models.ts の RETIRED）
    const mine = rows.map((r, i) => ({ r, i })).filter((x) => currentModelId(x.r.proposer ?? "") !== modelId).sort((a, b) => order.indexOf(a.i) - order.indexOf(b.i));
    if (!mine.length) return Promise.resolve({ who: modelId, scores: [] as { id: string; score: number }[] });
    return ask<{ scores: { id: string; score: number }[] }>({
      purpose: "朝会（提案の仮の採点）",
      modelId,
      system: `提案箱に入った、まだ点のない改善案を採点します。だれの案かは伏せてあります。点は仮の点で、7点以上なら月曜の定例会議を待たずに直す対象になります（定例会議で、1週間分をまとめて採点し直します）。
${SCORE_RULES}
早く直すべき重要なものだけが7点以上になるようにする
形式: {"scores":[{"id":"P1","score":点}]}`,
      user: `${material}\n\n採点する案:\n${mine.map((x) => `【${label(x.i)}】（${x.r.target === "system" ? "仕組み" : "運営者"}向け）${x.r.title}: ${x.r.how ?? ""}（根拠: ${x.r.why ?? ""}）`).join("\n")}`,
      validate: (v): v is { scores: { id: string; score: number }[] } => isObj(v) && Array.isArray(v.scores),
    }).then((o) => ({ who: modelId, scores: o.scores }));
  }));
  const per = rows.map((_, i) => got.flatMap((g) => {
    if (g.status !== "fulfilled") return [];
    const s = g.value.scores.find((x) => isObj(x) && String(x.id).trim() === label(i));
    return s && Number.isFinite(Number(s.score)) ? [{ who: g.value.who, score: Math.max(1, Math.min(10, Number(s.score))) }] : [];
  }));
  const adjusted = adjustScores(per);
  let scored = 0;
  let high = 0;
  const upd = db().prepare("UPDATE plan_requests SET score = ?, score_provisional = 1 WHERE id = ? AND status = 'open' AND score IS NULL AND ai_fix_at IS NULL");
  rows.forEach((r, i) => {
    if (per[i].length < PROVISIONAL_MIN_SCORERS) return;
    const sc = Math.round(adjusted[i] * 10) / 10;
    if (upd.run(sc, r.id).changes) {
      scored++;
      if (sc >= 7) high++;
    }
  });
  const failed = got.filter((g) => g.status === "rejected").length;
  if (scored || failed) logEvent(null, "ai", "provisional-score", `朝会で、点のない提案${rows.length}件に仮の点を付けました（${scored}件・7点以上は${high}件で、月曜を待たずに自動の依頼の対象）${failed ? `。${failed}社の採点を取れませんでした` : ""}`);
  return { scored, high };
}
