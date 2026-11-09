import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Page } from "playwright-core";

// ブラウザの画面の変化をそのまま受け取り、縦長の mp4（音なし）にする
// page は 1080×1920・deviceScaleFactor 1 で開いておくこと（画面の受け取りは倍率を無視するため、実寸で開く）
// release は撮り終えたあと、変換の前に呼ぶ（サーバーのメモリが少ないので、ブラウザを先に閉じる）
export async function recordToMp4(page: Page, run: () => Promise<void>, out: string, release?: () => Promise<void>): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "video-"));
  try {
    const frames: { file: string; t: number }[] = [];
    const cdp = await page.context().newCDPSession(page);
    cdp.on("Page.screencastFrame", (e) => {
      const file = path.join(dir, `f${String(frames.length).padStart(5, "0")}.jpg`);
      fs.writeFileSync(file, Buffer.from(e.data, "base64"));
      frames.push({ file, t: e.metadata.timestamp ?? Date.now() / 1000 });
      void cdp.send("Page.screencastFrameAck", { sessionId: e.sessionId }).catch(() => undefined);
    });
    await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: 1080, maxHeight: 1920 });
    await page.waitForTimeout(300);
    await run();
    await page.waitForTimeout(300);
    await cdp.send("Page.stopScreencast");
    if (frames.length < 2) throw new Error("画面を撮れませんでした");
    await release?.();
    // 受け取った時刻の間隔のまま動画にする（動きがない間は同じ画面を出し続ける）
    const list = frames.map((f, i) => `file '${f.file}'\nduration ${Math.max(0.01, (frames[i + 1]?.t ?? f.t + 0.5) - f.t).toFixed(3)}`).join("\n");
    const listFile = path.join(dir, "list.txt");
    fs.writeFileSync(listFile, `${list}\nfile '${frames.at(-1)!.file}'\n`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    // メモリを節約する設定（スレッドを絞り、先読みをしない）
    const r = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-threads", "1", "-filter_threads", "1", "-f", "concat", "-safe", "0", "-i", listFile, "-vf", "scale=1080:1920,setsar=1,fps=30", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-x264-params", "threads=1:rc-lookahead=0:ref=1:bframes=0", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out], { encoding: "utf8" });
    if (r.error) throw new Error(`動画に変換できませんでした: ${r.error.message}`);
    if (r.signal) throw new Error(`動画への変換が途中で止められました（${r.signal}。サーバーのメモリ不足の可能性があります）`);
    if (r.status !== 0) throw new Error(`動画に変換できませんでした: ${(r.stderr || "").trim().slice(0, 300)}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
