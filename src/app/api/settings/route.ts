import { NextResponse } from "next/server";
import { getSettings, saveSettings } from "@/lib/db";
import { MODELS } from "@/lib/models";

export async function GET() {
  return NextResponse.json(getSettings());
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
  if (typeof body.lpBaseUrl === "string") {
    const v = body.lpBaseUrl.trim();
    if (v && !/^https:\/\/[^\s/]+(\/[^\s]*)?$/.test(v)) return NextResponse.json({ error: "LPサイトのURLは https:// から始めてください" }, { status: 400 });
    patch.lpBaseUrl = v;
  }
  if (body.loopModel !== undefined) {
    if (!MODELS.some((m) => m.id === body.loopModel)) return NextResponse.json({ error: "モデルが不正です" }, { status: 400 });
    patch.loopModel = body.loopModel as string;
  }
  if (body.approvalMode !== undefined) {
    if (!["manual", "auto", "alternate"].includes(body.approvalMode as string)) return NextResponse.json({ error: "モードが不正です" }, { status: 400 });
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
    ["staleDays", 1, 90],
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
