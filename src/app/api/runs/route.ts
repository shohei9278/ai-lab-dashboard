import { NextResponse } from "next/server";
import { createRun, estimate, validate, type RunConfig } from "@/lib/runner";
import { getSettings } from "@/lib/db";

function parse(body: Record<string, unknown>): RunConfig {
  return {
    task: body.task as RunConfig["task"],
    models: Array.isArray(body.models) ? (body.models as string[]) : [],
    reps: Number(body.reps),
    variant: body.variant === "detailed" ? "detailed" : "basic",
    lang: body.lang === "en" ? "en" : "ja",
    mock: body.mock !== false,
    note: typeof body.note === "string" ? body.note.slice(0, 200) : undefined,
  };
}

// dryRun: true なら見積もりだけ返す
export async function POST(req: Request) {
  const body = (await req.json()) as Record<string, unknown>;
  const cfg = parse(body);
  const error = validate(cfg);
  const est = cfg.models.length ? estimate(cfg) : { calls: 0, usd: 0, perModel: [] };
  const { usdJpy } = getSettings();
  if (body.dryRun) return NextResponse.json({ error, estimate: est, usdJpy });
  if (error) return NextResponse.json({ error }, { status: 400 });
  const id = createRun(cfg);
  return NextResponse.json({ id });
}
