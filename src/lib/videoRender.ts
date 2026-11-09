import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Page } from "playwright-core";

// ブラウザの画面の変化をそのまま受け取り、縦長の mp4（音なし）にする
// page は 1080×1920・deviceScaleFactor 1 で開いておくこと（画面の受け取りは倍率を無視するため、実寸で開く）
export async function recordToMp4(page: Page, run: () => Promise<void>, out: string): Promise<void> {
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
    // 受け取った時刻の間隔のまま動画にする（動きがない間は同じ画面を出し続ける）
    const list = frames.map((f, i) => `file '${f.file}'\nduration ${Math.max(0.01, (frames[i + 1]?.t ?? f.t + 0.5) - f.t).toFixed(3)}`).join("\n");
    const listFile = path.join(dir, "list.txt");
    fs.writeFileSync(listFile, `${list}\nfile '${frames.at(-1)!.file}'\n`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", listFile, "-vf", "scale=1080:1920,setsar=1,fps=30", "-c:v", "libx264", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
