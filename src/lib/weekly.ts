import { callJson, isObj, isStr } from "./ai";
import { db, getSettings, saveSettings } from "./db";
import { logEvent } from "./loop";
import { hasKey, modelInfo } from "./models";
import { PLAN_MODELS, type RequestRow } from "./plan";
import { postStatsText } from "./postStats";
import { createReport, gather } from "./report";
import { followUpOf, type WeeklyContent } from "./meetings";
import type { AdhocContent } from "./adhoc";
import { STALE_NOTE, addProposal, addVoice } from "./voices";
import { outsideText, recordVoiceEffects } from "./outside";
import { researchText } from "./research";
import { doneEffectsText } from "./effects";

// 週の定例会議（毎週月曜）
// 1. 3社のAIが、同じ材料（1週間の数字・計画と達成度・提案箱の返事など）から、それぞれ振り返りと改善案を出す
// 2. だれの案かを伏せて、自分以外の案を採点し合う
// 3. 平均点の上位を提案箱に入れる（運営者がやること / 仕組みの改善）。この週に提案箱に入った提案も一緒に採点し、5点未満は閉じる
// 4. 議長（週ごとに交代）が、議事録のまとめと発信用の下書き（Xの投稿・記事）を書く

type Proposal = { title: string; how: string; why: string; target: "human" | "system" };
type MemberOut = { review: string; proposals: (Proposal & { axis?: unknown })[]; voice?: string };
const NEW_AXIS = "別軸: "; // まだ試していない手の案に付ける（提案箱でも見分けられるように）

const day = (d: Date) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(d);

export function members(): string[] {
  return PLAN_MODELS.filter((id) => hasKey(modelInfo(id).provider));
}

// 議長は、議長を務めた回が少ないAIから
export function chairFor(list: string[]): string {
  const counts = new Map((db().prepare("SELECT chair_model AS m, COUNT(*) AS n FROM meetings GROUP BY chair_model").all() as { m: string; n: number }[]).map((r) => [r.m, r.n]));
  return [...list].sort((a, b) => (counts.get(a) ?? 0) - (counts.get(b) ?? 0) || Math.random() - 0.5)[0];
}

export function meetingMaterial(start: string): string {
  const plans = (db().prepare("SELECT day, model_id, content FROM daily_plans WHERE day >= ? ORDER BY day").all(start) as { day: string; model_id: string; content: string }[])
    .map((p) => { const c = JSON.parse(p.content) as { focus: string; bottleneck: string }; return `- ${p.day} 担当 ${modelInfo(p.model_id).label}: ネック ${c.bottleneck}・${c.focus}`; });
  const reqs = (db().prepare("SELECT * FROM plan_requests WHERE created_at >= datetime('now', '-45 days') ORDER BY id DESC").all() as RequestRow[])
    .map((r) => `- 「${r.title}」（${r.target === "system" ? "仕組み" : "運営者"}向け）→ ${r.status === "open" ? "返事待ち" : r.status === "done" ? "やった" : r.note === STALE_NOTE ? "返事がないまま見送り（今も効くなら、もう一度出してよい）" : "見送り"}${r.repeats ? `・同じ趣旨の提案がほかに${r.repeats}回出た` : ""}${r.note && r.note !== STALE_NOTE ? `・運営者のひとこと: ${r.note}` : ""}`);
  // 仕組みの改善の偏り: 返事待ちが、どこで出て、だれが出したものに偏っているか（作業の途中のチェックの手順の足しばかりになっていた。運営者が「幅が狭くないか」と気にした）
  const openSys = db().prepare("SELECT source, scene, proposer FROM plan_requests WHERE status = 'open' AND target = 'system' AND source != 'human'").all() as { source: string; scene: string | null; proposer: string | null }[];
  const tally = (xs: string[]) => [...xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}件`).join("・");
  const skew = openSys.length ? `返事待ちの仕組みの改善 ${openSys.length}件: 出た場面 ${tally(openSys.map((r) => r.scene ?? r.source))} / 出したAI ${tally(openSys.map((r) => (r.proposer ? modelInfo(r.proposer).label : "システム")))}` : "返事待ちの仕組みの改善はない";
  // 人の手: この1週間に運営者が手でやったこと（種類ごとの回数）。人の手を減らす案の材料
  // 種類の名前だけでは何をしたか分からないので、いちばん新しい記録の文を1つ添える
  const human = (db().prepare("SELECT kind, COUNT(*) AS n, (SELECT message FROM events e2 WHERE e2.actor = 'human' AND e2.kind = e.kind ORDER BY e2.id DESC LIMIT 1) AS last FROM events e WHERE actor = 'human' AND at >= ? GROUP BY kind ORDER BY n DESC LIMIT 15").all(`${start} 00:00:00`) as { kind: string; n: number; last: string }[])
    .map((h) => `- ${h.kind} ${h.n}回（例: ${h.last.slice(0, 80)}）`).join("\n");
  return `${gather(start)}

${outsideText()}
${researchText()}

毎朝の計画（日替わりの担当）:
${plans.join("\n") || "（なし）"}

${postStatsText() || "効いた手の集計: まだ投稿がない"}

提案箱（これまでの提案と、運営者の返事。返事待ち・見送りと同じ提案は出さない）:
${reqs.join("\n") || "（まだなし）"}

${doneEffectsText()}

提案箱の偏り: ${skew}
運営者が手でやったこと（この1週間・記録の種類ごと）:
${human || "（なし）"}

社員の声（この1週間のつぶやき。何度も出ている心配は、改善案にする価値がある）:
${(db().prepare("SELECT model_id, scene, text FROM voices WHERE at >= datetime('now', '-7 days') ORDER BY id DESC LIMIT 40").all() as { model_id: string | null; scene: string; text: string }[]).map((v) => `- ${v.model_id ? modelInfo(v.model_id).label : "システム"}（${v.scene}）: ${v.text}`).join("\n") || "（なし）"}`;
}

export async function createWeeklyMeeting(): Promise<number> {
  const list = members();
  if (list.length < 2) throw new Error("定例会議には、2社以上のAIのキーが必要です");
  const end = new Date();
  const start = day(new Date(end.getTime() - 7 * 86_400_000));
  const mat = meetingMaterial(start);

  // 1. それぞれが振り返りと改善案を出す
  const outs = await Promise.allSettled(list.map((modelId) => callJson<MemberOut>({
    purpose: "定例会議（振り返りと提案）",
    modelId,
    system: `あなたは「AIが自動でプロダクトを作る実験」をしている会社の社員（AI）です。週の定例会議で、1週間を振り返り、改善案を出します。ほかの社員（別の会社のAI）も同じ材料から案を出し、だれの案かを伏せて採点し合います。
出すもの:
- review: 1週間の振り返り。次の5つに、材料の数字と外の声を根拠に順に答える（分からないものは「まだ分からない」と書く）
  1. 誰に届いたか（どの場所から、どんな人が来たか）
  2. 何に使われたか（登録・利用・外の声から分かること）
  3. AIは何を変えたか（ページ・投稿の切り口・場所・作るものなど）と、材料の「やった改善の前後」「前の版」から、効いたように見えるもの・見えないもの
  4. 人間はどこで助けたか（運営者が手でやったこと・提案箱でやったこと）
  5. まだ分からないことは何か
- voice_effects: 外の声や調べたことを根拠に、提案や考えを変えたときだけ [{"voice_ids":[声の番号],"research_ids":[調べものの番号],"change":"何をどう変えたか"}]
- proposals: 改善案を0〜3件（本当に効きそうなものがなければ空の配列でよい。数を埋めるための案は出さない）。target は次のどちらか
  - human: 運営者（人）にやってほしいこと（AIは他人への働きかけ・アカウントの設定・コミュニティへの参加などができない）
  - system: この会社の仕組み（AIへの指示・集計のしかた・自動化の決まり・作るものの選び方など）を変える案
  title は短く、how は具体的に何をどう変えるか、why は材料の数字の根拠
  - system の案は、次の観点を見渡して考える。提案箱の偏り（材料）を見て、返事待ちに多い観点より、少ない観点を優先する
    ①届ける（訪問を増やす仕組み）②作るものの質（ツール・LP の作り方・確かめ方）③人の手を減らす（材料の「運営者が手でやったこと」を、自動にできないか）④費用（目的別のAI費用）⑤数字の使い方（集めているのに判断に使っていない数字）
  - system の案は、運営者が提案箱で押すと、Claude Code がそのままコードを直して PR にする。how は、何をどう変えれば終わりかが分かる具体さで書く（どの作業の、どの決まり・指示・集計を、どう変えるか）
  - 3件のうち1件は、思いつけば「別軸」の案にしてよい（axis を "new" に）。今のやり方の改善ではなく、まだ試していない手（動画など新しい発信の形・新しい場所・届け方・作るものの形を変えるなど）。how には ①何をするか ②自動でできるか、人の手が要るか（人が手でやる形でもよい）③小さく試す方法 ④何の数字で続けるか決めるか を書く。外のサービスの規約やAPIの制約は、確かでなければ断定せず「要確認」と書く。why には、今のネックにどう効くかを書く
- voice: 今週のひとこと（80文字以内）。感想・気づき・この会社へのダメ出し・試したいことなど何でもよい。遠慮はいらない
守ること:
- 材料にある数字だけを使う。件数が少ないときは「まだ偶然の可能性が高い」と書く
- 提案箱で返事待ち・見送りになっているものと同じ提案は出さない
- 広告費を使う案、他人の投稿への宣伝の返信・DMなど、スパムになる案は出さない
- voice は必ず書く（空にしない）。数字や出来事は材料にあるものだけを使い、体験談は作らない
形式: {"review":"振り返り","proposals":[{"title":"短い題","how":"具体的に","why":"根拠","target":"human|system","axis":"new（別軸の案のときだけ）"}],"voice":"今週のひとこと","voice_effects":[]}`,
    user: mat,
    // ひとことは必ず書いてもらう（省きがちなので。抜けていたら、1回だけ書き直してもらう）
    validate: (v): v is MemberOut => isObj(v) && isStr(v.review) && Array.isArray(v.proposals) && isStr(v.voice),
  })));
  const got = list.flatMap((modelId, i) => {
    const o = outs[i];
    return o.status === "fulfilled" ? [{ modelId, review: o.value.review.slice(0, 1500), proposals: o.value.proposals.filter((p) => isObj(p) && isStr(p.title)).slice(0, 3).map((p) => ({
      title: `${p.axis === "new" ? NEW_AXIS : ""}${p.title.trim()}`.slice(0, 80), how: String(p.how ?? "").slice(0, 500), why: String(p.why ?? "").slice(0, 300), target: p.target === "system" ? "system" as const : "human" as const,
    })) }] : [];
  });
  if (got.length < 2) throw new Error("2社以上の振り返りが集まらなかったため、定例会議を開けませんでした");
  // 今週のひとことは「社員の声」に残す
  list.forEach((modelId, i) => {
    const o = outs[i];
    if (o.status === "fulfilled" && isStr(o.value.voice)) addVoice({ modelId, scene: "定例会議", text: o.value.voice });
    if (o.status === "fulfilled") recordVoiceEffects((o.value as { voice_effects?: unknown }).voice_effects, { scene: "定例会議", modelId });
  });

  // 2. だれの案かを伏せて、自分以外の案を採点し合う
  // 今回の案と、この週に提案箱に入った提案・まだ点のない返事待ちの提案（あなたが入れたもの・会議の案は除く）を一緒に採点する
  // 点のない提案は、入った週の会議で採点されないと、いつまでも返事待ちに残っていた（運営者が、明らかに不要なものは自動で見送りにするか尋ね、おすすめを選んだ）
  // Claude Code に頼んだ提案は採点しない（PR ができる前に低評価で見送りになると、マージしても「やった」にならない。PR #126 の ai-review の指摘）
  const existing = (db().prepare("SELECT * FROM plan_requests WHERE status = 'open' AND source != 'human' AND (source != 'meeting' OR scene LIKE '臨時会議%') AND (created_at >= datetime('now', '-8 days') OR score IS NULL) AND ai_fix_at IS NULL").all() as RequestRow[])
    .map((r) => ({ title: r.title, how: r.how ?? "", why: r.why ?? "", target: r.target, proposer: r.proposer ?? "", existingId: r.id as number | undefined }));
  const pool = [...got.flatMap((m) => m.proposals.map((p) => ({ ...p, proposer: m.modelId, existingId: undefined as number | undefined }))), ...existing];
  const order = pool.map((_, i) => i).sort(() => Math.random() - 0.5);
  const label = (i: number) => `P${order.indexOf(i) + 1}`;
  const scored = await Promise.allSettled(got.map((m) => {
    const mine = pool.map((p, i) => ({ p, i })).filter((x) => x.p.proposer !== m.modelId).sort((a, b) => order.indexOf(a.i) - order.indexOf(b.i));
    // 採点する案がなければ、AIは呼ばない（だれも案を出さなかった週など）
    if (!mine.length) return Promise.resolve({ who: m.modelId, scores: [] as { id: string; score: number }[], same: [] as unknown[] });
    return callJson<{ scores: { id: string; score: number }[]; same?: unknown }>({
      purpose: "定例会議（提案の採点）",
      modelId: m.modelId,
      system: `週の定例会議で出た改善案を採点します。だれの案かは伏せてあります。
観点: 材料の数字に根拠があるか / 実際にやれるか / やったら成果（訪問・登録・利用）に効きそうか / スパムや作り話にならないか
「別軸:」で始まる案は、まだ実績がないので数字の根拠では比べない。今のネックに効く理屈があるか、小さく試せるか、うまくいかなかったときの損が小さいかで見る
1〜10点で、甘くしないこと（平凡なら5点前後）。並んだ案どうしを比べて、良いものと良くないものに差を付ける（全部に同じ点を付けない）
same: 言い方は違っても、やることが同じ案の組（例: [["P2","P5"]]）。片方をやれば、もう片方をやる意味がなくなるものだけ。似た話題・同じ場所を直すだけの別の案は入れない。なければ空の配列
形式: {"scores":[{"id":"P1","score":点}],"same":[["P1","P4"]]}`,
      user: `${mat}\n\n採点する案:\n${mine.map((x) => `【${label(x.i)}】（${x.p.target === "system" ? "仕組み" : "運営者"}向け）${x.p.title}: ${x.p.how}（根拠: ${x.p.why}）`).join("\n")}`,
      validate: (v): v is { scores: { id: string; score: number }[] } => isObj(v) && Array.isArray(v.scores),
    }).then((r) => ({ who: m.modelId, scores: r.scores, same: Array.isArray(r.same) ? r.same : [] }));
  }));
  const ranked = pool.map((p, i) => {
    const scores = scored.flatMap((r) => {
      if (r.status !== "fulfilled") return [];
      const s = r.value.scores.find((x) => String(x.id).trim() === label(i));
      return s && Number.isFinite(Number(s.score)) ? [{ who: r.value.who, score: Math.max(1, Math.min(10, Number(s.score))) }] : [];
    });
    return { ...p, idx: i, scores, raw: scores.length ? scores.reduce((n, x) => n + x.score, 0) / scores.length : 0, score: 0 };
  });
  // 採点者ごとの甘さ・辛さをならした点で、並べて採るか決める（ある採点者はほぼ全部に8点、別の採点者はほぼ全部に5点を付け、平均がそろって差が付かなかった）
  const adjusted = adjustScores(ranked.map((p) => p.scores));
  ranked.forEach((p, k) => { p.score = adjusted[k]; });
  ranked.sort((a, b) => b.score - a.score);

  // 同じ提案の組（言い方が違うと文字の重なりでは見分けられないので、採点のときに答えてもらう。運営者が足すと決めた）
  // 残すのは、提案箱にあるもの（点の高いもの）、なければ今回の案の点の高いもの。残さないほうは、今回の案なら提案箱に入れず、提案箱のものはまとめて消す
  const byLabel = new Map(pool.map((_, i) => [label(i), i]));
  const groups = sameGroups(pool.length, (who, i, j) => pool[i].proposer !== who && pool[j].proposer !== who,
    scored.flatMap((r) => (r.status === "fulfilled" ? [{ who: r.value.who, pairs: r.value.same.flatMap((x) => (Array.isArray(x) && x.length === 2 && byLabel.has(String(x[0]).trim()) && byLabel.has(String(x[1]).trim()) ? [[byLabel.get(String(x[0]).trim())!, byLabel.get(String(x[1]).trim())!] as [number, number]] : [])) }] : [])));
  const byIdx = new Map(ranked.map((p) => [p.idx, p]));
  const dupOf = new Map<number, number>(); // まとめるほう → 残すほう
  for (const g of groups) {
    const items = g.map((i) => byIdx.get(i)!);
    const inBox = items.filter((x) => x.existingId);
    const keep = (inBox.length ? inBox : items).reduce((a, b) => (b.score > a.score ? b : a));
    for (const x of items) if (x !== keep) dupOf.set(x.idx, keep.idx);
  }
  const extraRepeats = new Map<number, number>();
  const bump = (keepIdx: number, n: number) => extraRepeats.set(keepIdx, (extraRepeats.get(keepIdx) ?? 0) + n);
  for (const [i, k] of dupOf) if (!pool[i].existingId) bump(k, 1);

  // 3. 今回の案の上位（6点以上・3件まで）を提案箱へ。この週に入っていた提案は点を付け、5点未満は閉じる
  const adopted = ranked.filter((p) => !p.existingId && !dupOf.has(p.idx) && p.score >= 6).slice(0, 3);
  // 別軸の案は、改善案に押し出されないよう、一番良いものを1件は入れる（5点以上）
  const bestNew = ranked.find((p) => !p.existingId && !dupOf.has(p.idx) && p.title.startsWith(NEW_AXIS) && p.score >= 5);
  if (bestNew && !adopted.includes(bestNew)) adopted.push(bestNew);
  let closed = 0;
  let mergedSame = 0;
  for (const p of ranked.filter((x) => x.existingId && x.scores.length)) {
    // 提案箱にある同じ提案は、残すほうにまとめて消す（社員の声から入れたもの・Claude Code に頼んだものは消さない）
    const k = dupOf.get(p.idx);
    if (k !== undefined && !db().prepare("SELECT 1 FROM plan_requests r WHERE r.id = ? AND (r.ai_fix_at IS NOT NULL OR EXISTS (SELECT 1 FROM voices v WHERE v.request_id = r.id))").get(p.existingId)) {
      const gone = db().prepare("SELECT repeats FROM plan_requests WHERE id = ? AND status = 'open'").get(p.existingId) as { repeats: number } | undefined;
      if (gone && db().prepare("DELETE FROM plan_requests WHERE id = ? AND status = 'open'").run(p.existingId).changes) { bump(k, 1 + gone.repeats); mergedSame++; }
      continue;
    }
    const sc = Math.round(p.score * 10) / 10;
    if (p.score < 5) {
      closed += db().prepare("UPDATE plan_requests SET score = ?, status = 'declined', note = ?, decided_at = datetime('now') WHERE id = ? AND status = 'open'").run(sc, `定例会議で低評価（平均${sc}点）のため自動で見送り`, p.existingId).changes;
    } else {
      db().prepare("UPDATE plan_requests SET score = ? WHERE id = ?").run(sc, p.existingId);
    }
  }

  // 4. 議長が議事録のまとめと発信用の下書きを書く
  const chair = chairFor(got.map((m) => m.modelId));
  const revisited = await revisitSplits(chair);
  const extra = `\n\n定例会議の振り返り（3社）:\n${got.map((m) => `- ${modelInfo(m.modelId).label}: ${m.review}`).join("\n")}\n\n定例会議で採用した提案:\n${adopted.map((p) => `- ${p.title}（${p.score.toFixed(1)}点）`).join("\n") || "（なし）"}`;
  const reportId = await createReport({ extra, modelId: chair, next: adopted.map((p) => `${p.title}（提案箱へ）`) });
  const summary = (JSON.parse((db().prepare("SELECT content FROM reports WHERE id = ?").get(reportId) as { content: string }).content) as { summary: string }).summary;

  const content: WeeklyContent = {
    members: got, chair, summary,
    ranked: ranked.map((p) => ({ title: p.existingId ? `（提案箱から）${p.title}` : p.title, proposer: p.proposer, score: Math.round(p.score * 10) / 10, raw: Math.round(p.raw * 10) / 10, scores: p.scores })),
  };
  const conn = db();
  const id = Number(conn.prepare("INSERT INTO meetings (period_start, period_end, chair_model, content, report_id) VALUES (?, ?, ?, ?, ?)")
    .run(start, day(end), chair, JSON.stringify(content), reportId).lastInsertRowid);
  let added = 0;
  for (const p of adopted) {
    const rid = addProposal({ title: p.title, how: p.how, why: p.why, target: p.target, source: "meeting", proposer: p.proposer, score: Math.round(p.score * 10) / 10, meetingId: id, scene: "週の定例会議" });
    if (rid) { added++; if (extraRepeats.get(p.idx)) db().prepare("UPDATE plan_requests SET repeats = repeats + ? WHERE id = ?").run(extraRepeats.get(p.idx), rid); }
  }
  // 提案箱にある、残すほうの提案に、まとめた回数を足す
  for (const [i, n] of extraRepeats) if (pool[i].existingId) db().prepare("UPDATE plan_requests SET repeats = repeats + ? WHERE id = ?").run(n, pool[i].existingId);
  logEvent(null, "ai", "meeting", `週の定例会議: ${got.length}社が${pool.length - existing.length}件の改善案を出し合い、${added}件を提案箱に入れました。この週の提案${existing.length}件も採点し、${closed}件を見送りにしました${dupOf.size ? `。同じ提案の組を見つけ、${dupOf.size}件をまとめました（提案箱から消したもの${mergedSame}件）` : ""}${revisited ? `。臨時会議の少数意見を${revisited}件、答え合わせしました` : ""}（議長 ${modelInfo(chair).label}）`);
  return id;
}

// 採点者ごとの甘さ・辛さをならす: 採点者が付けた点から、その採点者の平均を引き、全体の平均を足す（1〜10に収める）
// 3件以上採点した採点者だけならす（少ないと、平均がその採点者の甘さを表さない）。点のない案は0点
export function adjustScores(items: { who: string; score: number }[][]): number[] {
  const all = items.flat();
  if (!all.length) return items.map(() => 0);
  const mean = (xs: number[]) => xs.reduce((n, x) => n + x, 0) / xs.length;
  const overall = mean(all.map((x) => x.score));
  const by = new Map<string, number[]>();
  for (const x of all) by.set(x.who, [...(by.get(x.who) ?? []), x.score]);
  const bias = new Map([...by].map(([who, xs]) => [who, xs.length >= 3 ? mean(xs) - overall : 0]));
  return items.map((xs) => (xs.length ? Math.max(1, Math.min(10, mean(xs.map((x) => x.score - (bias.get(x.who) ?? 0))))) : 0));
}

// 同じ提案の組を、まとまりにする
// 組を採用するのは、両方の案を見た採点者のうち、半分以上（1人以上）が「同じ」と答えたとき（自分の案は採点しないので、見ていない採点者もいる）
export function sameGroups(n: number, sawBoth: (who: string, i: number, j: number) => boolean, answers: { who: string; pairs: [number, number][] }[]): number[][] {
  const votes = new Map<string, Set<string>>();
  for (const a of answers) for (const [x, y] of a.pairs) {
    if (x === y || x < 0 || y < 0 || x >= n || y >= n || !sawBoth(a.who, x, y)) continue;
    const k = x < y ? `${x},${y}` : `${y},${x}`;
    votes.set(k, (votes.get(k) ?? new Set()).add(a.who));
  }
  const parent = Array.from({ length: n }, (_, i) => i);
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i])));
  for (const [k, who] of votes) {
    const [x, y] = k.split(",").map(Number);
    const saw = answers.filter((a) => sawBoth(a.who, x, y)).length;
    if (who.size * 2 >= saw) parent[root(x)] = root(y);
  }
  const by = new Map<number, number[]>();
  for (let i = 0; i < n; i++) by.set(root(i), [...(by.get(root(i)) ?? []), i]);
  return [...by.values()].filter((g) => g.length > 1);
}

// 少数意見の答え合わせ: 臨時会議で意見が割れ、振り返る日が来たものについて、少数派の心配が実際に起きたかを議長が数字で確かめる
// 実行しなかった案が正しかったかまでは分からないので、「心配したことが起きたか」だけを見る
export async function revisitSplits(chair: string): Promise<number> {
  const rows = db().prepare("SELECT id, at, content FROM meetings WHERE kind = 'adhoc'").all() as { id: number; at: string; content: string }[];
  let n = 0;
  for (const r of rows) {
    const c = JSON.parse(r.content) as AdhocContent;
    const f = followUpOf(r.id, r.at, c);
    if (!f?.due || c.revisit) continue;
    const per = (x: { days: number; visits: number }) => (x.days ? (x.visits / x.days).toFixed(1) : "—");
    try {
      const out = await callJson<{ happened: string; note: string }>({
        purpose: "定例会議（少数意見の答え合わせ）",
        modelId: chair,
        system: `以前の会議で意見が割れたところを振り返ります。多数派の案を選んだあと、少数派が心配していたことが実際に起きたかを、数字で確かめます。
実行しなかった少数派の案が正しかったかまでは分からないので、そこは書かない。数字が足りなければ unclear にする。
形式: {"happened":"yes|no|unclear","note":"根拠の数字を入れて1〜2文"}`,
        user: `議題: ${c.topic}
結論: ${c.conclusion}
多数派: ${f.split.majority}
少数派: ${f.split.minority}
少数派の心配: ${f.split.concern}
確かめ方: ${f.split.watch}

会議で決めたことと、実際にやったか: ${f.actions.map((a) => `「${a.title}」${a.status}`).join("・") || "（なし）"}
1日あたりの訪問: 会議の前7日 ${per(f.before)}人 → 会議のあと${f.after.days}日 ${per(f.after)}人 / 登録・利用: 前 ${f.before.conversions}人 → あと ${f.after.conversions}人`,
        validate: (v): v is { happened: string; note: string } => isObj(v) && isStr(v.happened) && isStr(v.note),
      });
      c.revisit = { at: new Date().toISOString(), happened: out.happened === "yes" ? "yes" : out.happened === "no" ? "no" : "unclear", note: out.note.slice(0, 400), by: chair };
      db().prepare("UPDATE meetings SET content = ? WHERE id = ?").run(JSON.stringify(c), r.id);
      n++;
    } catch (e) {
      logEvent(null, "system", "meeting-error", `少数意見の答え合わせでエラー: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`);
    }
  }
  return n;
}

// 毎週月曜（毎日の自動実行の時刻以降）に1回だけ開く
export async function maybeWeeklyMeeting() {
  const s = getSettings();
  const now = new Date();
  if (!s.weeklyReport || s.killSwitch || now.getDay() !== 1 || now.getHours() < s.dailyHour || s.lastWeeklyReport === day(now)) return;
  // 失敗しても5分ごとに開き直さないよう、先に印を付ける
  saveSettings({ lastWeeklyReport: day(now) });
  await createWeeklyMeeting();
}
