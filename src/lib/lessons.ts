import { callJson, isObj, isStr } from "./ai";
import { db, type LessonRow } from "./db";
import { logEvent } from "./loop";

// 教訓が、どの判断に使われたかをたどる（11/26 に運営者が決めた）
// - アイデア出しと朝会に、教訓を番号つきで渡す。教訓を見て判断を変えたときだけ、番号と変えたことを書かせて残す（見ただけ・参照しただけは残さない）
// - 残した使い方を、変えた先の結果（ページの直しの答え合わせ・試しの判定・案件の当たりや撤退）につなぐ。結果がまだのもの・判断できなかったものは、
//   効いたとも効かなかったとも数えない
// - 結果の出た使い方が2件以上ある教訓は、週の定例会議で議長のAIが「維持・直す・保留」を決める（教訓はAIのメモなので、AIが決める。運営者が決めた）。
//   保留した教訓はAIに渡さない。直した教訓は、新しい教訓として書き直し、元の番号を残す。運営者はノートの画面で、保留を戻せる

export type LessonUseKind = "idea" | "improve" | "trial" | "promo" | "plain" | "other";
export const USE_KINDS: LessonUseKind[] = ["idea", "improve", "trial", "promo", "plain", "other"];
export const USE_KIND_LABEL: Record<LessonUseKind, string> = { idea: "アイデア", improve: "ページの直し", trial: "試し", promo: "宣伝の投稿", plain: "普通の投稿", other: "そのほか" };
export type UseOutcome = "good" | "bad" | "unclear" | "pending" | "none";
export const REVIEW_MIN_DECIDED = 2;

type UseRow = { id: number; at: string; lesson_id: number; scene: string; model_id: string | null; project_id: number | null; kind: LessonUseKind; change: string };

const activeIds = () => new Set((db().prepare("SELECT id FROM lessons WHERE active = 1").all() as { id: number }[]).map((r) => r.id));
const ids = (v: unknown): number[] => (Array.isArray(v) ? v : [v]).map(Number).filter((n) => Number.isInteger(n) && n > 0);

function insert(lessonId: number, scene: string, modelId: string | null, projectId: number | null, kind: LessonUseKind, change: string) {
  db().prepare("INSERT INTO lesson_uses (lesson_id, scene, model_id, project_id, kind, change) VALUES (?, ?, ?, ?, ?, ?)").run(lessonId, scene, modelId, projectId, kind, change.slice(0, 300));
}

// 朝会の lesson_effects: [{"lesson_ids":[番号],"project_id":番号,"what":"improve|trial|promo|plain|other","change":"何をどう変えたか"}]
export function recordPlanLessonEffects(raw: unknown, ctx: { modelId: string | null; scene?: string }): number {
  if (!Array.isArray(raw)) return 0;
  const known = activeIds();
  let n = 0;
  for (const e of raw) {
    if (!isObj(e) || !isStr(e.change) || !e.change.trim()) continue;
    const kind = USE_KINDS.includes(e.what as LessonUseKind) && e.what !== "idea" ? (e.what as LessonUseKind) : "other";
    const pid = Number.isInteger(Number(e.project_id)) && Number(e.project_id) > 0 ? Number(e.project_id) : null;
    for (const id of ids(e.lesson_ids).filter((x) => known.has(x))) {
      insert(id, ctx.scene ?? "朝会", ctx.modelId, pid, kind, e.change.trim());
      n++;
    }
  }
  if (n) logEvent(null, "ai", "lesson-use", `${ctx.scene ?? "朝会"}で、教訓を見て判断を${n}件変えました`);
  return n;
}

// アイデアの lessons_used: [{"id":番号,"change":"何をどう変えたか"}]（案件になったアイデアだけ残す）
export function recordIdeaLessons(raw: unknown, projectId: number, modelId: string | null): number {
  if (!Array.isArray(raw)) return 0;
  const known = activeIds();
  let n = 0;
  for (const e of raw) {
    if (!isObj(e) || !isStr(e.change) || !e.change.trim()) continue;
    for (const id of ids(e.id).filter((x) => known.has(x))) {
      insert(id, "アイデア出し", modelId, projectId, "idea", e.change.trim());
      n++;
    }
  }
  return n;
}

// 使い方の結果（変えた先の結果。まだ出ていない・判断できなかったものは、効いたとも効かなかったとも数えない）
export function outcomeOfUse(u: Pick<UseRow, "at" | "project_id" | "kind">): UseOutcome {
  if (!u.project_id) return "none";
  if (u.kind === "idea") {
    const p = db().prepare("SELECT stage, growth_phase, spread_hit FROM projects WHERE id = ?").get(u.project_id) as { stage: string; growth_phase: number; spread_hit: number | null } | undefined;
    if (!p) return "none";
    if (p.growth_phase || p.spread_hit === 1) return "good";
    if (p.stage === "killed" || p.spread_hit === 0) return "bad";
    return "pending";
  }
  if (u.kind === "improve") {
    const v = db().prepare("SELECT check_verdict FROM lp_versions WHERE project_id = ? AND improve_check IS NOT NULL AND created_at >= ? ORDER BY version LIMIT 1").get(u.project_id, u.at) as { check_verdict: string | null } | undefined;
    if (!v) return "pending";
    return v.check_verdict === "better" ? "good" : v.check_verdict === "worse" ? "bad" : v.check_verdict ? "unclear" : "pending";
  }
  if (u.kind === "trial") {
    const t = db().prepare("SELECT status, verdict FROM plan_trials WHERE project_id = ? AND created_at >= datetime(?, '-1 hours') ORDER BY id LIMIT 1").get(u.project_id, u.at) as { status: string; verdict: string | null } | undefined;
    if (!t || t.status === "open") return "pending";
    return t.verdict === "win" ? "good" : t.verdict === "lose" ? "bad" : "unclear";
  }
  return "none";
}

export type LessonStat = { uses: number; good: number; bad: number; unclear: number; pending: number; none: number; last: { change: string; kind: LessonUseKind; outcome: UseOutcome }[] };
export function lessonStats(): Map<number, LessonStat> {
  const out = new Map<number, LessonStat>();
  for (const u of db().prepare("SELECT * FROM lesson_uses ORDER BY id DESC").all() as UseRow[]) {
    const s = out.get(u.lesson_id) ?? { uses: 0, good: 0, bad: 0, unclear: 0, pending: 0, none: 0, last: [] };
    const o = outcomeOfUse(u);
    s.uses++;
    s[o]++;
    if (s.last.length < 3) s.last.push({ change: u.change, kind: u.kind, outcome: o });
    out.set(u.lesson_id, s);
  }
  return out;
}
const decided = (s: LessonStat) => s.good + s.bad;
export const OUTCOME_LABEL: Record<UseOutcome, string> = { good: "良かった", bad: "悪かった", unclear: "判断できなかった", pending: "まだ", none: "測れない" };

const lessonText = (l: LessonRow) => (l.fact ? `事実: ${l.fact} / 仮の解釈: ${l.interpretation ?? l.text}${l.unknown ? ` / まだ分からない: ${l.unknown}` : ""}` : l.text);

// 見直しの材料（結果の出た使い方が2件以上ある、今使っている教訓）
export function reviewableLessons(): { lesson: LessonRow; stat: LessonStat }[] {
  const stats = lessonStats();
  return (db().prepare("SELECT * FROM lessons WHERE active = 1 ORDER BY id").all() as LessonRow[])
    .flatMap((l) => {
      const s = stats.get(l.id);
      return s && decided(s) >= REVIEW_MIN_DECIDED ? [{ lesson: l, stat: s }] : [];
    });
}

type Review = { id: number; action: "keep" | "revise" | "hold"; why: string; fact?: string; interpretation?: string; unknown?: string; certainty?: string };

// 定例会議の議長が、教訓ごとに維持・直す・保留を決める（対象がなければAIは呼ばない）
export async function reviewLessons(chair: string, ask: typeof callJson = callJson): Promise<{ kept: number; revised: number; held: number }> {
  const list = reviewableLessons();
  const res = { kept: 0, revised: 0, held: 0 };
  if (!list.length) return res;
  const material = list.map(({ lesson: l, stat: s }) =>
    `【教訓${l.id}】${lessonText(l)}\n  使われた ${s.uses}回: 良かった${s.good}・悪かった${s.bad}・判断できなかった${s.unclear}・まだ${s.pending}\n  最近の使い方: ${s.last.map((x) => `${USE_KIND_LABEL[x.kind]}で「${x.change}」→ ${OUTCOME_LABEL[x.outcome]}`).join(" / ")}`).join("\n");
  const out = await ask<{ reviews: Review[] }>({
    purpose: "定例会議（教訓の見直し）",
    modelId: chair,
    system: `あなたは、AIが自動でプロダクトを作る実験の定例会議の議長です。AIの社員が使ってきた教訓を、使った結果を見て見直します。
教訓ごとに、次のどれかを決める:
- keep: 維持する（結果が教訓と合っている、または、まだ決めるほどの差がない）
- revise: 直す（結果の一部が教訓と食い違う。条件を足す・言い方を弱めるなど）。fact・interpretation・unknown・certainty（low|mid|high）に、直した教訓を書く
- hold: 保留する（結果が教訓と逆を向いている。これからのアイデア出しと朝会に渡さない）
守ること:
- 材料にある回数と結果だけを根拠にする。「判断できなかった」「まだ」は、良かったとも悪かったとも数えない
- 件数が少ないので、決めつけない。迷ったら keep にする
- why に、根拠の回数を入れて1文で書く
形式: {"reviews":[{"id":教訓の番号,"action":"keep|revise|hold","why":"根拠","fact":"","interpretation":"","unknown":"","certainty":"low"}]}`,
    user: `見直す教訓（結果の出た使い方が${REVIEW_MIN_DECIDED}件以上あるもの）:\n${material}`,
    validate: (v): v is { reviews: Review[] } => isObj(v) && Array.isArray(v.reviews),
  });
  const allowed = new Map(list.map((x) => [x.lesson.id, x.lesson]));
  for (const r of out.reviews) {
    if (!isObj(r)) continue;
    const l = allowed.get(Number(r.id));
    const why = isStr(r.why) ? r.why.trim().slice(0, 300) : "";
    if (!l || !why) continue;
    allowed.delete(l.id);
    if (r.action === "hold") {
      db().prepare("UPDATE lessons SET active = 0, hold_reason = ?, held_at = datetime('now'), reviewed_at = datetime('now') WHERE id = ?").run(why, l.id);
      logEvent(l.project_id, "ai", "lesson-hold", `定例会議で、教訓${l.id}を保留にしました（これからのアイデア出しと朝会に渡しません）: ${why}`);
      res.held++;
    } else if (r.action === "revise" && isStr(r.interpretation) && r.interpretation.trim()) {
      const certainty = r.certainty === "high" || r.certainty === "mid" ? r.certainty : "low";
      const nid = Number(db().prepare("INSERT INTO lessons (project_id, text, fact, interpretation, unknown, certainty, revised_from) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(l.project_id, r.interpretation.trim().slice(0, 400), isStr(r.fact) ? r.fact.trim().slice(0, 400) : l.fact, r.interpretation.trim().slice(0, 400), isStr(r.unknown) ? r.unknown.trim().slice(0, 400) : null, certainty, l.id).lastInsertRowid);
      db().prepare("UPDATE lessons SET active = 0, replaced_by = ?, hold_reason = ?, reviewed_at = datetime('now') WHERE id = ?").run(nid, `直して教訓${nid}にした: ${why}`, l.id);
      logEvent(l.project_id, "ai", "lesson-revise", `定例会議で、教訓${l.id}を直して教訓${nid}にしました: ${why}`);
      res.revised++;
    } else {
      db().prepare("UPDATE lessons SET reviewed_at = datetime('now') WHERE id = ?").run(l.id);
      res.kept++;
    }
  }
  return res;
}

// 運営者が、保留した（または直して置き換えた）教訓を戻す（ノートの画面から）
export function restoreLesson(id: number): boolean {
  const n = db().prepare("UPDATE lessons SET active = 1, hold_reason = NULL, held_at = NULL WHERE id = ? AND active = 0 AND replaced_by IS NULL").run(id).changes;
  if (n) logEvent(null, "human", "lesson-restore", `保留していた教訓${id}を、AIに渡す教訓に戻しました`);
  return n > 0;
}

// ノートの画面に出す、保留・置き換えた教訓
export function inactiveLessons(): LessonRow[] {
  return db().prepare("SELECT * FROM lessons WHERE active = 0 AND (hold_reason IS NOT NULL OR replaced_by IS NOT NULL) ORDER BY COALESCE(held_at, reviewed_at) DESC LIMIT 30").all() as LessonRow[];
}

// 朝会・アイデア出しの指示に足す文
export const LESSON_USE_RULE = "教訓には【教訓12】のように番号がある。教訓を見て判断や案を変えたときだけ、その番号と、何をどう変えたかを書く（見ただけ・参照しただけのときは書かない）";
