import { NextResponse } from "next/server";
import { addNote, deleteNote, parseNote, updateNote } from "@/lib/notes";
import { restoreLesson } from "@/lib/lessons";

// 実験メモの追加・編集・削除
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    switch (body.action) {
      case "add":
        return NextResponse.json({ id: addNote({ ...parseNote(body), author: body.author === "ai" ? "ai" : "human" }) });
      case "update":
        updateNote(Number(body.id), parseNote(body));
        return NextResponse.json({ ok: true });
      case "delete":
        deleteNote(Number(body.id));
        return NextResponse.json({ ok: true });
      // 定例会議で保留した教訓を、AIに渡す教訓に戻す（運営者だけ。来訪者の GET 以外は入口で 403。lessons.ts）
      case "restore-lesson":
        if (!restoreLesson(Number(body.id))) return NextResponse.json({ error: "戻せる教訓ではありません" }, { status: 400 });
        return NextResponse.json({ ok: true });
      default:
        return NextResponse.json({ error: "操作が不正です" }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
