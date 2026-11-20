// 手元で確かめるスクリプト（play-check・tool-preview）の、画像（素材）の指定を読む
// --image 名前=ファイル を、公開と同じ window.labAssets.images の形（名前 → URL）にする。手元では画像そのもの（data: の URL）を渡す
import fs from "node:fs";
import { sniffImage } from "../src/lib/toolAssets";
import { TOOL_IMAGES_MAX, TOOL_IMAGE_BYTES_MAX, TOOL_IMAGE_NAME, type ToolImages } from "../lp-site/src/lp/content";

export function parseArgs(argv: string[]): { positional: string[]; images: ToolImages | undefined } {
  const positional: string[] = [];
  const images: ToolImages = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== "--image") { positional.push(argv[i]); continue; }
    const spec = argv[++i] ?? "";
    const eq = spec.indexOf("=");
    const name = spec.slice(0, eq), file = spec.slice(eq + 1);
    if (eq < 1 || !TOOL_IMAGE_NAME.test(name)) throw new Error(`--image は「名前=ファイル」の形で、名前は英小文字で始まる英小文字・数字・_ の24文字まで: ${spec}`);
    const bytes = fs.readFileSync(file);
    if (bytes.length > TOOL_IMAGE_BYTES_MAX) throw new Error(`${file} が大きすぎます（${TOOL_IMAGE_BYTES_MAX / 1024 / 1024}MB まで。本番でも入れられません）`);
    const type = sniffImage(bytes);
    if (!type) throw new Error(`${file} は PNG・JPEG・WebP ではありません`);
    images[name] = `data:${type};base64,${bytes.toString("base64")}`;
  }
  if (Object.keys(images).length > TOOL_IMAGES_MAX) throw new Error(`画像は${TOOL_IMAGES_MAX}枚までです`);
  return { positional, images: Object.keys(images).length ? images : undefined };
}
