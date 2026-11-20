import crypto from "node:crypto";
import { db } from "./db";
import { getProject, logEvent } from "./loop";
import { uploadImage } from "./publish";
import { TOOL_IMAGES_MAX, TOOL_IMAGE_BYTES_MAX, TOOL_IMAGE_NAME, type ToolImages } from "../../lp-site/src/lp/content";

// じっくり案件のツールに付ける画像（素材）（運営者の依頼。#72 のスノードームを、AIで作った景色の画像で作るため）
// - 人が開発のカードから、名前を付けて入れる。画像は公開用の保存領域に置く（ほかのページからの読み込みを許しているので、ツールの canvas・WebGL にも描ける）
// - ツールは window.labAssets.images.名前 で URL を読む。版ごとに、そのときの画像の一覧を残す（入れ直しても、公開済みの版の画像は変わらない）

export type ToolAsset = { name: string; url: string; type: string; bytes: number; at: string };

const EXT = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" } as const;
type ImageType = keyof typeof EXT;

// 中身の先頭のバイトから、画像の種類を決める（名前や申告された種類は信じない）
export function sniffImage(b: Buffer): ImageType | null {
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 12 && b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}

export function toolAssets(projectId: number): ToolAsset[] {
  return db().prepare("SELECT name, url, type, bytes, at FROM tool_assets WHERE project_id = ? ORDER BY name").all(projectId) as ToolAsset[];
}

// ツールに渡す形（名前 → URL）。なければ undefined
export function toolImages(projectId: number): ToolImages | undefined {
  const a = toolAssets(projectId);
  return a.length ? Object.fromEntries(a.map((x) => [x.name, x.url])) : undefined;
}

// 画像を入れる（同じ名前なら差し替える）。決まりに合わないものは、理由を返して入れない
export async function addToolAsset(projectId: number, name: string, base64: string): Promise<ToolAsset> {
  const p = getProject(projectId);
  if (!p || p.kind !== "tool" || !p.deep) throw new Error("画像を入れられるのは、じっくり案件のツールだけです");
  if (!TOOL_IMAGE_NAME.test(name)) throw new Error("名前は、英小文字で始まる英小文字・数字・_ の24文字までにしてください（例: night, depth）");
  const bytes = Buffer.from(base64, "base64");
  if (!bytes.length) throw new Error("画像が空です");
  if (bytes.length > TOOL_IMAGE_BYTES_MAX) throw new Error(`画像が大きすぎます（${(bytes.length / 1024 / 1024).toFixed(1)}MB。${TOOL_IMAGE_BYTES_MAX / 1024 / 1024}MB まで）`);
  const type = sniffImage(bytes);
  if (!type) throw new Error("PNG・JPEG・WebP の画像だけ入れられます");
  const now = toolAssets(projectId);
  if (!now.some((a) => a.name === name) && now.length >= TOOL_IMAGES_MAX) throw new Error(`画像は${TOOL_IMAGES_MAX}枚までです（いらないものを外してから入れてください）`);
  // 中身ごとに別の場所に置く（差し替えても、公開済みの版が前の画像を読めるように）
  const hash = crypto.createHash("sha256").update(bytes).digest("hex").slice(0, 10);
  const url = await uploadImage(`tool-assets/p${projectId}/${name}-${hash}.${EXT[type]}`, bytes, type);
  const replaced = now.some((a) => a.name === name);
  db().prepare("INSERT INTO tool_assets (project_id, name, url, type, bytes) VALUES (?, ?, ?, ?, ?) ON CONFLICT(project_id, name) DO UPDATE SET url = excluded.url, type = excluded.type, bytes = excluded.bytes, at = datetime('now')")
    .run(projectId, name, url, type, bytes.length);
  logEvent(projectId, "human", "tool-asset", `ツールの画像「${name}」（${(bytes.length / 1024).toFixed(0)}KB）を${replaced ? "差し替えました" : "入れました"}。次にツールを入れた版から使えます`);
  return toolAssets(projectId).find((a) => a.name === name)!;
}

// 画像を外す（保存領域の画像は消さない。公開済みの版が読み続けられるように）
export function removeToolAsset(projectId: number, name: string): void {
  const r = db().prepare("DELETE FROM tool_assets WHERE project_id = ? AND name = ?").run(projectId, name);
  if (!r.changes) throw new Error(`画像「${name}」が見つかりません`);
  logEvent(projectId, "human", "tool-asset", `ツールの画像「${name}」を外しました。次にツールを入れた版から使われなくなります`);
}
