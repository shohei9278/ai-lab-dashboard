import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import { db } from "../src/lib/db";
import { devRequestText } from "../src/lib/loop";
import { addToolAsset, removeToolAsset, sniffImage, toolImages } from "../src/lib/toolAssets";
import { TOOL_IMAGES_MAX, TOOL_IMAGE_BYTES_MAX, normalizeLp, toolImagesOf } from "../lp-site/src/lp/content";
import { wrapToolHtml } from "../lp-site/src/lp/toolHtml";

// 運営者の依頼（#72）: じっくり案件のツールに、人が入れた画像（素材）を付け、ツールの中で window.labAssets.images として読めるようにする
const URL1 = "https://abc.supabase.co/storage/v1/object/public/lp-images/tool-assets/p1/night-0123456789.jpg";
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WEBP")]);

test("ツールの画像: 名前の形・https の URL・数の上限に合う一覧だけを使う", () => {
  assert.deepEqual(toolImagesOf({ night: URL1, depth_map: URL1 }), { night: URL1, depth_map: URL1 });
  for (const bad of [null, [], {}, { Night: URL1 }, { "1a": URL1 }, { night: "http://x/a.jpg" }, { night: "javascript:alert(1)" }, { night: 'https://x/a.jpg"><script>' }, { a: URL1, b: URL1, c: URL1, d: URL1, e: URL1 }]) {
    assert.equal(toolImagesOf(bad), undefined, JSON.stringify(bad));
  }
  // 画像そのもの（data: の URL）は、手元で確かめるとき（allowData）だけ
  const data = "data:image/png;base64,iVBORw0KGgo=";
  assert.equal(toolImagesOf({ night: data }), undefined);
  assert.deepEqual(toolImagesOf({ night: data }, true), { night: data });
  assert.equal(TOOL_IMAGES_MAX, 4);
});

test("ツールの画像: 枠の中で window.labAssets.images として読め、その場所の画像だけ読み込みを許す", () => {
  const h = wrapToolHtml("<p>t</p>", { images: { night: URL1 } });
  assert.match(h, /window\.labAssets=\{"images":\{"night":"https:\/\/abc\.supabase\.co\/storage/);
  assert.match(h, /img-src data: blob: https:\/\/abc\.supabase\.co;/);
  // 通信（connect-src）は開けない
  assert.doesNotMatch(h, /connect-src/);
  // 紹介イラストと同じ場所なら、CSP に2回書かない
  const both = wrapToolHtml("<p>t</p>", { images: { night: URL1 }, illustration: "https://abc.supabase.co/storage/v1/object/public/lp-images/x.jpg" });
  assert.match(both, /img-src data: blob: https:\/\/abc\.supabase\.co;/);
  assert.match(both, /"illustration":"https:\/\/abc/);
  // 形の違う一覧は、置かない（読み込みも許さない）
  const bad = wrapToolHtml("<p>t</p>", { images: { night: "https://evil.example/a.jpg", "BAD NAME": URL1 } });
  assert.match(bad, /window\.labAssets=\{\};/);
  assert.match(bad, /img-src data: blob:;/);
});

test("ツールの画像: 公開する中身（LP）を整えるときも、画像の一覧を残す", () => {
  const lp = normalizeLp({ headline: "h", subheadline: "s", pains: [], features: [], cta: "c", faq: [], tool: { html: "<p>t</p>", shareText: "x", images: { night: URL1 } } });
  assert.deepEqual(lp.tool?.images, { night: URL1 });
  const bad = normalizeLp({ headline: "h", subheadline: "s", pains: [], features: [], cta: "c", faq: [], tool: { html: "<p>t</p>", shareText: "x", images: { night: "http://x" } } });
  assert.equal(bad.tool?.images, undefined);
});

test("ツールの画像: 中身の先頭から画像の種類を決める（名前や申告された種類は信じない）", () => {
  assert.equal(sniffImage(PNG), "image/png");
  assert.equal(sniffImage(JPG), "image/jpeg");
  assert.equal(sniffImage(WEBP), "image/webp");
  assert.equal(sniffImage(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>")), null);
  assert.equal(sniffImage(Buffer.from("GIF89a")), null);
});

const addProject = (deep: number) => Number(db().prepare(
  "INSERT INTO projects (title, target, problem, solution, hypothesis, ai_reason, stage, model_id, kind, deep, aim) VALUES ('ドーム', 't', 'p', 's', 'h', 'r', 'idea', 'claude', 'tool', ?, 'spread')",
).run(deep).lastInsertRowid);

test("ツールの画像: 入れる前に、案件・名前・大きさ・種類・枚数を確かめ、合わないものは理由を返す", async () => {
  const plain = addProject(0);
  await assert.rejects(addToolAsset(plain, "night", PNG.toString("base64")), /じっくり案件のツールだけ/);
  const id = addProject(1);
  await assert.rejects(addToolAsset(id, "Night", PNG.toString("base64")), /英小文字で始まる/);
  await assert.rejects(addToolAsset(id, "night", ""), /空です/);
  await assert.rejects(addToolAsset(id, "night", Buffer.alloc(TOOL_IMAGE_BYTES_MAX + 1, 1).toString("base64")), /大きすぎます/);
  await assert.rejects(addToolAsset(id, "night", Buffer.from("<svg/>").toString("base64")), /PNG・JPEG・WebP/);
  // 上限の枚数まで入っていたら、新しい名前は断る（同じ名前の差し替えは、保存領域に置きに行く）
  for (const n of ["a", "b", "c", "d"]) db().prepare("INSERT INTO tool_assets (project_id, name, url, type, bytes) VALUES (?, ?, ?, 'image/png', 10)").run(id, n, URL1);
  await assert.rejects(addToolAsset(id, "night", PNG.toString("base64")), /4枚まで/);
  // テストでは保存領域がないので、差し替えは保存のところで失敗し、一覧は変わらない
  await assert.rejects(addToolAsset(id, "a", PNG.toString("base64")), /Supabase の設定がない/);
  assert.deepEqual(Object.keys(toolImages(id)!), ["a", "b", "c", "d"]);
  removeToolAsset(id, "d");
  assert.deepEqual(Object.keys(toolImages(id)!), ["a", "b", "c"]);
  assert.throws(() => removeToolAsset(id, "d"), /見つかりません/);
  assert.match((db().prepare("SELECT message FROM events WHERE project_id = ? AND kind = 'tool-asset'").get(id) as { message: string }).message, /「d」を外しました/);
});

test("ツールの画像: Claude Code への依頼文に、入れた画像と使い方（crossOrigin・手元での確かめ方）を書く", () => {
  const id = addProject(1);
  assert.match(devRequestText(id, "## 一言で\nドーム", null), /## 画像（素材）\nなし。画像が要るときは/);
  db().prepare("INSERT INTO tool_assets (project_id, name, url, type, bytes) VALUES (?, 'night', ?, 'image/jpeg', 512000)").run(id, URL1);
  const t = devRequestText(id, "## 一言で\nドーム", null);
  assert.match(t, /- night: image\/jpeg・500KB → window\.labAssets\.images\.night/);
  assert.match(t, /crossOrigin = "anonymous"/);
  assert.match(t, /scripts\/tool-preview\.mts <ツールのHTML> --image 名前=ファイル/);
  assert.deepEqual(toolImages(id), { night: URL1 });
});
