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

type UseRow = { id: number; at: string; lesson_id: number; scene: string; model_id: string | null; project_id: number | null; kind: LessonUseKind; ref_id: number | null; change: string };

// 教訓の番号は、正の整数か、数字だけの文字だけを受け付ける（変な形の値で例外を出して、朝会の保存を途中で止めない。PR #211 の ai-review の指摘）
const ids = (v: unknown): number[] =>
  (Array.isArray(v) ? v : [v]).flatMap((x) => {
    const n = typeof x === "number" ? x : typeof x === "string" && /^\s*\d+\s*$/.test(x) ? Number(x) : NaN;
    return Number.isSafeInteger(n) && n > 0 ? [n] : [];
  });

// その回に渡した教訓（アイデア出しは新しい順に20件・実験枠は渡さない、朝会は10件）。渡していない番号は受け付けない（PR #211 の ai-review の指摘）
export const shownLessonIds = (limit: number): Set<number> =>
  new Set((db().prepare("SELECT id FROM lessons WHERE active = 1 ORDER BY id DESC LIMIT ?").all(limit) as { id: number }[]).map((r) => r.id));

// 教訓の使い方を残す。raw は [{"id":番号,"change":"何をどう変えたか"}]（朝会は lesson_ids でもよい）
// 変えた先（kind と、案件・版・試しの番号 refId）ごとに1件だけ残す（同じ判断を2回数えない。PR #211 の ai-review の指摘）
export function recordLessonUses(raw: unknown, ctx: { allowed: Set<number>; scene: string; modelId: string | null; projectId: number | null; kind: LessonUseKind; refId?: number | null }): number {
  if (!Array.isArray(raw) || !ctx.allowed.size) return 0;
  const ins = db().prepare("INSERT OR IGNORE INTO lesson_uses (lesson_id, scene, model_id, project_id, kind, ref_id, change) VALUES (?, ?, ?, ?, ?, ?, ?)");
  let n = 0;
  for (const e of raw) {
    if (!isObj(e) || !isStr(e.change) || !e.change.trim()) continue;
    for (const id of ids(e.id ?? e.lesson_ids).filter((x) => ctx.allowed.has(x))) n += ins.run(id, ctx.scene, ctx.modelId, ctx.projectId, ctx.kind, ctx.refId ?? null, e.change.trim().slice(0, 300)).changes;
  }
  if (n) logEvent(ctx.projectId, "ai", "lesson-use", `${ctx.scene}で、教訓を見て${USE_KIND_LABEL[ctx.kind]}を変えました（${n}件）`);
  return n;
}

// 朝会の予定・試しに付いた教訓の使い方（[{"id":番号,"change":"..."}]）を、保存できる形にする（実行して結果が出る先が決まってから残すため。PR #211 の ai-review の指摘）
export function lessonsJson(raw: unknown, allowed: Set<number>): string | null {
  if (!Array.isArray(raw)) return null;
  const list = raw.flatMap((e) => {
    if (!isObj(e) || !isStr(e.change) || !e.change.trim()) return [];
    const change = e.change.trim().slice(0, 300);
    return ids(e.id).filter((x) => allowed.has(x)).map((id) => ({ id, change }));
  });
  return list.length ? JSON.stringify(list.slice(0, 10)) : null;
}

// 使い方の結果（変えた先の結果。まだ出ていない・判断できなかったものは、効いたとも効かなかったとも数えない）
// ページの直しは実際に直して公開した版、試しはその試しを、番号で引く（同じ案件の別の施策の結果を拾わない。PR #211 の ai-review の指摘）
export function outcomeOfUse(u: Pick<UseRow, "project_id" | "kind" | "ref_id">): UseOutcome {
  if (!u.project_id) return "none";
  if (u.kind === "idea") {
    const p = db().prepare("SELECT stage, growth_phase, spread_hit FROM projects WHERE id = ?").get(u.project_id) as { stage: string; growth_phase: number; spread_hit: number | null } | undefined;
    if (!p) return "none";
    if (p.growth_phase || p.spread_hit === 1) return "good";
    if (p.stage === "killed" || p.spread_hit === 0) return "bad";
    return "pending";
  }
  if (u.kind === "improve") {
    if (!u.ref_id) return "none";
    const v = db().prepare("SELECT improve_check, check_verdict FROM lp_versions WHERE project_id = ? AND version = ?").get(u.project_id, u.ref_id) as { improve_check: string | null; check_verdict: string | null } | undefined;
    if (!v?.improve_check) return "none";
    return v.check_verdict === "better" ? "good" : v.check_verdict === "worse" ? "bad" : v.check_verdict ? "unclear" : "pending";
  }
  if (u.kind === "trial") {
    if (!u.ref_id) return "none";
    const t = db().prepare("SELECT status, verdict FROM plan_trials WHERE id = ?").get(u.ref_id) as { status: string; verdict: string | null } | undefined;
    if (!t) return "none";
    if (t.status === "open") return "pending";
    return t.verdict === "win" ? "good" : t.verdict === "lose" ? "bad" : "unclear";
  }
  return "none";
}

export type LessonUseView = { at: string; change: string; kind: LessonUseKind; projectId: number | null; refId: number | null; outcome: UseOutcome };
export type LessonStat = { uses: number; good: number; bad: number; unclear: number; pending: number; none: number; list: LessonUseView[] };
export function lessonStats(): Map<number, LessonStat> {
  const out = new Map<number, LessonStat>();
  for (const u of db().prepare("SELECT * FROM lesson_uses ORDER BY id DESC").all() as UseRow[]) {
    const s = out.get(u.lesson_id) ?? { uses: 0, good: 0, bad: 0, unclear: 0, pending: 0, none: 0, list: [] };
    const o = outcomeOfUse(u);
    s.uses++;
    s[o]++;
    s.list.push({ at: u.at, change: u.change, kind: u.kind, projectId: u.project_id, refId: u.ref_id, outcome: o });
    out.set(u.lesson_id, s);
  }
  return out;
}
export const OUTCOME_LABEL: Record<UseOutcome, string> = { good: "良かった", bad: "悪かった", unclear: "判断できなかった", pending: "まだ", none: "測れない" };

const lessonText = (l: LessonRow) => (l.fact ? `事実: ${l.fact} / 仮の解釈: ${l.interpretation ?? l.text}${l.unknown ? ` / まだ分からない: ${l.unknown}` : ""}` : l.text);

// 見直しの対象: 結果の出た使い方が2件以上あり、前に見直した（または運営者が戻した）ときより、結果の出た使い方が増えた教訓
// （同じ根拠のまま、毎週見直し直したり、運営者が戻した教訓をすぐ保留し直したりしない。使った日時ではなく、結果の出た数で見る。PR #211 の ai-review の指摘）
export const decidedCount = (s: LessonStat | undefined) => (s ? s.good + s.bad : 0);
export function reviewableLessons(): { lesson: LessonRow; stat: LessonStat }[] {
  const stats = lessonStats();
  return (db().prepare("SELECT * FROM lessons WHERE active = 1 ORDER BY id").all() as LessonRow[])
    .flatMap((l) => {
      const s = stats.get(l.id);
      const n = decidedCount(s);
      if (!s || n < REVIEW_MIN_DECIDED || (l.reviewed_decided !== null && n <= l.reviewed_decided)) return [];
      return [{ lesson: l, stat: s }];
    });
}

type Review = { id: number; action: string; why: string; fact?: string; interpretation?: string; unknown?: string; certainty?: string };

// 定例会議の議長が、教訓ごとに維持・直す・保留を決める（対象がなければAIは呼ばない）
export async function reviewLessons(chair: string, ask: typeof callJson = callJson): Promise<{ kept: number; revised: number; held: number }> {
  const list = reviewableLessons();
  const res = { kept: 0, revised: 0, held: 0 };
  if (!list.length) return res;
  const material = list.map(({ lesson: l, stat: s }) =>
    `【教訓${l.id}】${lessonText(l)}\n  使われた ${s.uses}回: 良かった${s.good}・悪かった${s.bad}・判断できなかった${s.unclear}・まだ${s.pending}\n  最近の使い方: ${s.list.slice(0, 3).map((x) => `${USE_KIND_LABEL[x.kind]}で「${x.change}」→ ${OUTCOME_LABEL[x.outcome]}`).join(" / ")}`).join("\n");
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
  const decidedNow = new Map(list.map((x) => [x.lesson.id, decidedCount(x.stat)]));
  const conn = db();
  for (const r of out.reviews) {
    if (!isObj(r)) continue;
    const l = allowed.get(Number(r.id));
    const why = isStr(r.why) ? r.why.trim().slice(0, 300) : "";
    // 決め方が分からない答え・中身のない「直す」は使わない（維持として数えない。PR #211 の ai-review の指摘）
    if (!l || !why || !["keep", "revise", "hold"].includes(r.action)) continue;
    if (r.action === "revise" && !(isStr(r.interpretation) && r.interpretation.trim())) continue;
    allowed.delete(l.id);
    if (r.action === "hold") {
      const n = conn.prepare("UPDATE lessons SET active = 0, hold_reason = ?, review_note = ?, held_at = datetime('now'), reviewed_at = datetime('now'), reviewed_decided = ? WHERE id = ? AND active = 1").run(why, `保留: ${why}`, decidedNow.get(l.id) ?? 0, l.id).changes;
      if (!n) continue;
      logEvent(l.project_id, "ai", "lesson-hold", `定例会議で、教訓${l.id}を保留にしました（これからのアイデア出しと朝会に渡しません）: ${why}`);
      res.held++;
    } else if (r.action === "revise") {
      const certainty = r.certainty === "high" || r.certainty === "mid" ? r.certainty : "low";
      const interp = (r.interpretation as string).trim().slice(0, 400);
      // 新しい教訓を書くことと、元の教訓を外すことを、1つのまとまりで行う（元の教訓がまだ使われているときだけ。PR #211 の ai-review の指摘）
      const nid = conn.transaction(() => {
        if (!conn.prepare("SELECT 1 FROM lessons WHERE id = ? AND active = 1").get(l.id)) return null;
        const id = Number(conn.prepare("INSERT INTO lessons (project_id, text, fact, interpretation, unknown, certainty, revised_from) VALUES (?, ?, ?, ?, ?, ?, ?)")
          .run(l.project_id, interp, isStr(r.fact) && r.fact.trim() ? r.fact.trim().slice(0, 400) : l.fact, interp, isStr(r.unknown) ? r.unknown.trim().slice(0, 400) : null, certainty, l.id).lastInsertRowid);
        conn.prepare("UPDATE lessons SET active = 0, replaced_by = ?, hold_reason = ?, review_note = ?, reviewed_at = datetime('now'), reviewed_decided = ? WHERE id = ?").run(id, `直して教訓${id}にした: ${why}`, `直す: ${why}`, decidedNow.get(l.id) ?? 0, l.id);
        return id;
      })();
      if (nid === null) continue;
      logEvent(l.project_id, "ai", "lesson-revise", `定例会議で、教訓${l.id}を直して教訓${nid}にしました: ${why}`);
      res.revised++;
    } else {
      conn.prepare("UPDATE lessons SET reviewed_at = datetime('now'), review_note = ?, reviewed_decided = ? WHERE id = ?").run(`維持: ${why}`, decidedNow.get(l.id) ?? 0, l.id);
      res.kept++;
    }
  }
  return res;
}

// 運営者が、保留した教訓を戻す（ノートの画面から。直して置き換えた教訓は戻さない）。戻したあとは、新しい結果が出るまで見直さない
export function restoreLesson(id: number): boolean {
  const n = db().prepare("UPDATE lessons SET active = 1, hold_reason = NULL, held_at = NULL, restored_at = datetime('now'), reviewed_decided = ? WHERE id = ? AND active = 0 AND replaced_by IS NULL AND hold_reason IS NOT NULL").run(decidedCount(lessonStats().get(id)), id).changes;
  if (n) logEvent(null, "human", "lesson-restore", `保留していた教訓${id}を、AIに渡す教訓に戻しました`);
  return n > 0;
}

// ノートの画面に出す、保留した教訓（戻せるものは全部）と、直して置き換えた教訓（新しい30件。PR #211 の ai-review の指摘）
export function inactiveLessons(): { held: LessonRow[]; replaced: LessonRow[] } {
  return {
    held: db().prepare("SELECT * FROM lessons WHERE active = 0 AND replaced_by IS NULL AND hold_reason IS NOT NULL ORDER BY held_at DESC").all() as LessonRow[],
    replaced: db().prepare("SELECT * FROM lessons WHERE active = 0 AND replaced_by IS NOT NULL ORDER BY reviewed_at DESC LIMIT 30").all() as LessonRow[],
  };
}

// 朝会・アイデア出しの指示に足す文
export const LESSON_USE_RULE = "教訓には【教訓12】のように番号がある。教訓を見て判断や案を変えたときだけ、その番号と、何をどう変えたかを書く（見ただけ・参照しただけのときは書かない）";
