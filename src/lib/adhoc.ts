import { callJson, isObj, isStr } from "./ai";
import { db } from "./db";
import { liveEnd, liveSay, liveStep, logEvent } from "./loop";
import { modelInfo } from "./models";
import { addProposal, addVoice } from "./voices";
import { notifyStart } from "./liveNotify";
import { chairFor, meetingMaterial, members } from "./weekly";

// 臨時会議: あなたが議題を出し、AIの社員が会議をする（会議室の「今すぐ会議」から）
// 1. それぞれが意見を出す → 2. ほかの社員の意見を読んで、反論・修正する（1往復）→ 3. 議長が結論をまとめ、やることを提案箱に入れる
// 進み具合はライブ画面に出し、終わったら議事録に残す

export type AdhocContent = {
  topic: string;
  rounds: { modelId: string; opinion: string; final?: string; changed?: boolean }[];
  conclusion: string;
  actions: { title: string; how: string; why: string; target: "human" | "system" }[];
  chair: string;
  // 意見が割れたところ（少数意見が心配したことが、その後に実際に起きたかを振り返るため）
  split?: { majority: string; minority: string; minorityBy: string[]; concern: string; watch: string; checkAfterDays: number };
  // 振り返りの結果（週の定例会議で、議長が数字を見て書く）
  revisit?: { at: string; happened: "yes" | "no" | "unclear"; note: string; by: string };
};

const g = globalThis as unknown as { __aiLabAdhoc?: string };
export const adhocRunning = (): string | null => g.__aiLabAdhoc ?? null;

const day = (d: Date) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(d);

// 画面を待たせないよう、裏で進める。始められたら true
export function startAdhocMeeting(topic: string, picked?: string[]): void {
  const t = topic.trim().slice(0, 300);
  if (!t) throw new Error("議題を書いてください");
  if (g.__aiLabAdhoc) throw new Error(`いま「${g.__aiLabAdhoc}」の会議をしています。終わってから開いてください`);
  const all = members();
  const list = picked?.length ? all.filter((m) => picked.includes(m)) : all;
  if (list.length < 2) throw new Error("会議には、2社以上のAIが必要です");
  g.__aiLabAdhoc = t.slice(0, 40);
  notifyStart(`臨時会議を始めます: 「${t.slice(0, 80)}」（${list.map((m) => modelInfo(m).label).join("・")}）`);
  void runAdhoc(t, list)
    .catch((e) => logEvent(null, "system", "meeting-error", `臨時会議「${t.slice(0, 40)}」でエラー: ${(e instanceof Error ? e.message : String(e)).slice(0, 300)}`))
    .finally(() => { g.__aiLabAdhoc = undefined; });
}

async function runAdhoc(topic: string, list: string[]): Promise<number> {
  const key = `adhoc-${Date.now()}`;
  const title = `臨時会議「${topic.slice(0, 30)}」`;
  const batch = key;
  const label = (id: string) => modelInfo(id).label;
  const say = (who: string, kind: string, text: string) => liveSay({ who: label(who), provider: modelInfo(who).provider, kind, text, batch });
  try {
    const mat = meetingMaterial(day(new Date(Date.now() - 7 * 86_400_000)));
    const rule = `守ること: 材料にある数字・出来事だけを根拠にする（件数が少ないときは「まだ偶然の可能性が高い」と書く）。体験談は作らない。広告費を使う案・スパムになる案は出さない`;

    // 1. それぞれが意見を出す
    list.forEach((m) => liveStep(key, title, label(m), "意見を考えています"));
    const first = await Promise.allSettled(list.map((modelId) => callJson<{ opinion: string }>({
      purpose: "臨時会議（意見）",
      modelId,
      system: `あなたは「AIが自動でプロダクトを作る実験」をしている会社の社員（AI）です。運営者が出した議題について、会議で意見を言います。ほかの社員（別の会社のAI）も同じ議題で意見を出し、あとで互いの意見を読んで議論します。
議題に正面から答え、結論と理由を書く（3〜6文）。
${rule}
形式: {"opinion":"意見"}`,
      user: `議題: ${topic}\n\n材料:\n${mat}`,
      validate: (v): v is { opinion: string } => isObj(v) && isStr(v.opinion),
    })));
    const rounds = list.flatMap((modelId, i) => {
      const r = first[i];
      if (r.status !== "fulfilled") { liveStep(key, title, label(modelId), "意見を出せませんでした"); return []; }
      say(modelId, "意見", r.value.opinion);
      liveStep(key, title, label(modelId), "意見を出しました");
      return [{ modelId, opinion: r.value.opinion.slice(0, 1500) } as AdhocContent["rounds"][number]];
    });
    if (rounds.length < 2) throw new Error("2社以上の意見が集まらなかったため、会議を開けませんでした");

    // 2. ほかの社員の意見を読んで、反論・修正する
    rounds.forEach((r) => liveStep(key, title, label(r.modelId), "ほかの意見を読んでいます"));
    const second = await Promise.allSettled(rounds.map((me) => callJson<{ final: string; changed: boolean }>({
      purpose: "臨時会議（反論）",
      modelId: me.modelId,
      system: `会議の続きです。ほかの社員の意見を読み、賛成できる所・反対の所を具体的に挙げて、最終的な意見を書きます（3〜5文）。納得したら考えを変えてよい（changed を true に）。ただ合わせるだけにはしない。
${rule}
形式: {"final":"最終的な意見","changed":true または false}`,
      user: `議題: ${topic}\n\nあなたの最初の意見:\n${me.opinion}\n\nほかの社員の意見:\n${rounds.filter((r) => r.modelId !== me.modelId).map((r) => `- ${label(r.modelId)}: ${r.opinion}`).join("\n")}\n\n材料:\n${mat}`,
      validate: (v): v is { final: string; changed: boolean } => isObj(v) && isStr(v.final),
    })));
    rounds.forEach((r, i) => {
      const s = second[i];
      if (s.status !== "fulfilled") return;
      r.final = s.value.final.slice(0, 1500);
      r.changed = !!s.value.changed;
      say(r.modelId, s.value.changed ? "考えを変えた" : "反論", s.value.final);
      liveStep(key, title, label(r.modelId), s.value.changed ? "考えを変えました" : "意見を固めました");
    });

    // 3. 議長が結論をまとめる
    const chair = chairFor(rounds.map((r) => r.modelId));
    liveStep(key, title, label(chair), "議長として結論をまとめています");
    const out = await callJson<{ conclusion: string; actions: AdhocContent["actions"]; voice?: string; split?: { majority?: unknown; minority?: unknown; minority_by?: unknown; concern?: unknown; watch?: unknown; check_after_days?: unknown } | null }>({
      purpose: "臨時会議（結論）",
      modelId: chair,
      system: `あなたは会議の議長です。議題と、社員それぞれの最初の意見・最終的な意見から、結論をまとめます。
- conclusion: 結論（意見が割れた所は割れたまま書く。3〜6文）
- actions: 結論からやること（0〜3件）。target は human（人が手を動かさないとできないこと。知人に聞く・コミュニティに相談する など）か system（AIへの指示・作るものの選び方・投稿のしかた・集計など、仕組みで変えられること）。やることがなければ空の配列
- voice: 議長としての、会議のひとこと（つぶやき程度、60文字以内。何でもよい）
- split: 最終的な意見が割れたときだけ。majority（多数派の考え）、minority（少数派の考え）、minority_by（少数派の社員の名前）、concern（少数派が心配していること＝多数派の案だとこうなるかもしれない、という具体的なこと）、watch（その心配が当たったかを、あとで何の数字で確かめられるか）、check_after_days（何日後に確かめるか。7か14）。全員が同じ考えなら null
${rule}
形式: {"conclusion":"結論","actions":[{"title":"短い題","how":"具体的に","why":"根拠","target":"human|system"}],"voice":"ひとこと","split":{"majority":"","minority":"","minority_by":["社員の名前"],"concern":"","watch":"","check_after_days":7} または null}`,
      user: `議題: ${topic}\n\n${rounds.map((r) => `${label(r.modelId)}\n- 最初の意見: ${r.opinion}\n- 最終的な意見: ${r.final ?? "（なし）"}`).join("\n\n")}`,
      validate: (v): v is { conclusion: string; actions: AdhocContent["actions"] } => isObj(v) && isStr(v.conclusion) && Array.isArray(v.actions),
    });
    say(chair, "結論", out.conclusion);
    const actions = out.actions.filter((a) => isObj(a) && isStr(a.title)).slice(0, 3)
      .map((a) => ({ title: a.title.trim().slice(0, 80), how: String(a.how ?? "").slice(0, 500), why: String(a.why ?? "").slice(0, 300), target: a.target === "human" ? "human" as const : "system" as const }));
    const sp = out.split;
    const split = sp && isStr(sp.minority) && isStr(sp.concern)
      ? {
          majority: String(sp.majority ?? "").slice(0, 400), minority: sp.minority.slice(0, 400),
          minorityBy: Array.isArray(sp.minority_by) ? sp.minority_by.filter(isStr).slice(0, 3) : [],
          concern: sp.concern.slice(0, 400), watch: String(sp.watch ?? "").slice(0, 300),
          checkAfterDays: Number(sp.check_after_days) === 14 ? 14 : 7,
        }
      : undefined;
    if (split) say(chair, "意見が割れたところ", `多数派: ${split.majority} ／ 少数派: ${split.minority}（心配: ${split.concern}）`);
    const content: AdhocContent = { topic, rounds, conclusion: out.conclusion.slice(0, 1500), actions, chair, split };
    const today = day(new Date());
    const id = Number(db().prepare("INSERT INTO meetings (period_start, period_end, chair_model, content, kind, topic) VALUES (?, ?, ?, ?, 'adhoc', ?)")
      .run(today, today, chair, JSON.stringify(content), topic).lastInsertRowid);
    let added = 0;
    for (const a of actions) {
      if (addProposal({ ...a, source: "meeting", proposer: chair, meetingId: id, scene: `臨時会議「${topic.slice(0, 20)}」` })) added++;
    }
    if (isStr(out.voice)) addVoice({ modelId: chair, scene: "臨時会議", text: out.voice });
    logEvent(null, "ai", "meeting", `臨時会議「${topic.slice(0, 40)}」: ${rounds.length}社で議論し、結論を出しました（議長 ${label(chair)}・提案箱へ ${added}件）`);
    return id;
  } finally {
    liveEnd(key);
  }
}
