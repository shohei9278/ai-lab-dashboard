import fs from "node:fs";
import { recordVideoPath } from "@/lib/recordVideo";
import { isOwner } from "@/lib/viewer";

// 作った動画を返す（投稿前のものなので運営者だけ）。スマホの再生に必要なので、範囲の指定にも応える
export async function GET(req: Request, { params }: { params: Promise<{ file: string }> }) {
  if (!(await isOwner())) return new Response("Forbidden", { status: 403 });
  const { file } = await params;
  const p = recordVideoPath(file);
  if (!p || !fs.existsSync(p)) return new Response("Not found", { status: 404 });
  const body = fs.readFileSync(p);
  const headers = { "Content-Type": "video/mp4", "Accept-Ranges": "bytes", "Cache-Control": "no-store" };
  const m = /bytes=(\d+)-(\d*)/.exec(req.headers.get("range") ?? "");
  if (!m) return new Response(body, { headers: { ...headers, "Content-Length": String(body.length) } });
  const start = Number(m[1]);
  const end = m[2] ? Math.min(Number(m[2]), body.length - 1) : body.length - 1;
  if (start > end) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${body.length}` } });
  return new Response(body.subarray(start, end + 1), { status: 206, headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${body.length}`, "Content-Length": String(end - start + 1) } });
}
