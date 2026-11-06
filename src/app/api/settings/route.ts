import { NextResponse } from "next/server";
import { getSettings, saveSettings } from "@/lib/db";
import { MODELS } from "@/lib/models";

export async function GET(req: Request) {
  const s = getSettings();
  if (req.headers.get("x-viewer") !== "owner") return NextResponse.json({ ...s, contactEmail: "", operatorName: "" });
  return NextResponse.json(s);
}

export async function POST(req: Request) {
  const body = (await req.json()) as Record<string, unknown>;
  const patch: Parameters<typeof saveSettings>[0] = {};
  if (body.monthlyBudgetJpy !== undefined) {
    const v = Number(body.monthlyBudgetJpy);
    if (!Number.isFinite(v) || v < 0) return NextResponse.json({ error: "予算が不正です" }, { status: 400 });
    patch.monthlyBudgetJpy = Math.round(v);
  }
  if (body.usdJpy !== undefined) {
    const v = Number(body.usdJpy);
    if (!Number.isFinite(v) || v <= 0) return NextResponse.json({ error: "為替レートが不正です" }, { status: 400 });
    patch.usdJpy = v;
  }
  if (typeof body.killSwitch === "boolean") patch.killSwitch = body.killSwitch;
  if (typeof body.dailyEnabled === "boolean") patch.dailyEnabled = body.dailyEnabled;
  if (typeof body.shadowJudge === "boolean") patch.shadowJudge = body.shadowJudge;
  if (typeof body.debateEnabled === "boolean") patch.debateEnabled = body.debateEnabled;
  if (typeof body.weeklyReport === "boolean") patch.weeklyReport = body.weeklyReport;
  if (typeof body.illustrations === "boolean") patch.illustrations = body.illustrations;
  if (typeof body.freePage === "boolean") patch.freePage = body.freePage;
  if (typeof body.fullAuto === "boolean") patch.fullAuto = body.fullAuto;
  if (typeof body.autoPost === "boolean") patch.autoPost = body.autoPost;
  if (typeof body.dailyPlan === "boolean") patch.dailyPlan = body.dailyPlan;
  for (const k of ["promoOff", "plainOff"] as const) {
    if (typeof body[k] === "string") patch[k] = body[k].split(",").map((x: string) => x.trim()).filter((x: string) => ["x", "threads", "bluesky"].includes(x)).join(",");
  }
  if (typeof body.viralSearch === "boolean") patch.viralSearch = body.viralSearch;
  if (typeof body.showcaseEnabled === "boolean") patch.showcaseEnabled = body.showcaseEnabled;
  if (typeof body.showcaseShowLinks === "boolean") patch.showcaseShowLinks = body.showcaseShowLinks;
  if (typeof body.showcaseVoices === "boolean") patch.showcaseVoices = body.showcaseVoices;
  if (typeof body.lpBaseUrl === "string") {
    const v = body.lpBaseUrl.trim();
    if (v && !/^https:\/\/[^\s/]+(\/[^\s]*)?$/.test(v)) return NextResponse.json({ error: "LPサイトのURLは https:// から始めてください" }, { status: 400 });
    patch.lpBaseUrl = v;
  }
  if (typeof body.trendNotes === "string") patch.trendNotes = body.trendNotes.trim().slice(0, 500);
  if (typeof body.snsAccount === "string") {
    const v = body.snsAccount.trim().replace(/^@/, "");
    if (v && !/^[A-Za-z0-9_]{1,15}$/.test(v)) return NextResponse.json({ error: "X のユーザー名は、英数字と _ の15文字以内です" }, { status: 400 });
    patch.snsAccount = v;
  }
  if (typeof body.operatorName === "string") patch.operatorName = body.operatorName.trim().slice(0, 60);
  if (typeof body.contactEmail === "string") {
    const v = body.contactEmail.trim();
    if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return NextResponse.json({ error: "問い合わせ先のメールアドレスを確認してください" }, { status: 400 });
    patch.contactEmail = v;
  }
  if (body.loopModel !== undefined) {
    if (!MODELS.some((m) => m.id === body.loopModel)) return NextResponse.json({ error: "モデルが不正です" }, { status: 400 });
    patch.loopModel = body.loopModel as string;
  }
  if (body.approvalMode !== undefined) {
    if (!["manual", "auto", "alternate", "confidence"].includes(body.approvalMode as string)) return NextResponse.json({ error: "モードが不正です" }, { status: 400 });
    patch.approvalMode = body.approvalMode as typeof patch.approvalMode;
  }
  const nums: [keyof typeof patch, number, number][] = [
    ["adBudgetPerProjectJpy", 0, 1_000_000],
    ["improveExtraBudgetJpy", 0, 1_000_000],
    ["judgeMinVisits", 1, 100_000],
    ["targetSignupRate", 0.001, 1],
    ["dailyHour", 0, 23],
    ["dailyIdeaCount", 1, 5],
    ["dailyKeep", 1, 5],
    ["maxPending", 1, 50],
    ["maxLive", 1, 20],
    ["maxAutoImprove", 0, 10],
    ["autoPublishPerWeek", 0, 50],
    ["autoPostPerDay", 1, 10],
    ["postSafetyPerDay", 1, 50],
    ["viralSearchCount", 100, 1000],
    ["wantsSearchCount", 0, 1000],
    ["judgeAfterDays", 1, 60],
    ["digestHour", 0, 23],
    ["staleDays", 1, 90],
    ["autoConfidence", 0, 1],
    ["targetUseRate", 0.001, 1],
  ];
  for (const [key, min, max] of nums) {
    if (body[key] === undefined) continue;
    const v = Number(body[key]);
    if (!Number.isFinite(v) || v < min || v > max) return NextResponse.json({ error: `${key} が不正です` }, { status: 400 });
    (patch as Record<string, number>)[key] = v;
  }
  saveSettings(patch);
  return NextResponse.json(getSettings());
}
