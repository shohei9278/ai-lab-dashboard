import assert from "node:assert/strict";
import { test } from "node:test";
import { claimNumbers, materialNumbers, normalizeDigits, unsupportedNumbers } from "../src/lib/numberCheck";

// 外に出す文の、実績に見える数字が、AIに渡した本物の材料にあるかを照らす（ハルシネーション対策）

const facts = "ビンゴ景品わりふり電卓\nページの特徴: 景品を3分で割り振る / 最大50人まで\n- 前の投稿（訪問 12人・利用 3人）\n実験の累計: 案件40件・公開25件";

test("数字の照らし合わせ: 材料にある数字は通し、材料にない実績の数字だけを返す", () => {
  assert.deepEqual(unsupportedNumbers("最大50人までの景品を、まとめて割り振れます", facts), []);
  assert.deepEqual(unsupportedNumbers("これまで25件公開してきました", facts), []);
  assert.deepEqual(unsupportedNumbers("もう300人が使っています！満足度98%", facts), ["300人", "98%"]);
  assert.deepEqual(unsupportedNumbers("1,200人が遊んだ", facts), ["1,200人"]);
  assert.deepEqual(unsupportedNumbers("2万ダウンロード突破", facts), ["2万ダウンロード"]);
});

test("数字の照らし合わせ: 中身の数字（つ・分など）と、0・1 は見ない。全角も半角にそろえる", () => {
  assert.deepEqual(claimNumbers("3つのコツと、5分でできる手順。1人でも、1回で遊べる"), []);
  assert.equal(normalizeDigits("３００人・９８％"), "300人・98%");
  assert.deepEqual(unsupportedNumbers("３００人が使った", facts), ["300人"]);
  assert.deepEqual(unsupportedNumbers("訪問12人から3人が使ってくれました", facts), []);
});

test("数字の照らし合わせ: 材料の数字は、カンマ・万・千もそろえて読む。万・千が付いたものは直した値だけ", () => {
  const m = materialNumbers("1,234件・2万人・1.5千回・1万2千人・3万4500回");
  for (const v of [1234, 20000, 1500, 12000, 34500]) assert.ok(m.has(v), String(v));
  // 「2万人」から「2」、「1.5千回」から「1.5」は材料に入れない（「2件」「1.5倍」を通さない）
  for (const v of [2, 1.5]) assert.ok(!m.has(v), String(v));
  assert.deepEqual(unsupportedNumbers("2件の新機能", "累計 2万人"), ["2件"]);
  assert.deepEqual(unsupportedNumbers("2万人が見た", "累計 20000人"), []);
  // 「1万2千人」「1万2000人」は 12000 として読む
  assert.deepEqual(claimNumbers("1万2千人・1万2000人").map((x) => x.value), [12000, 12000]);
  assert.deepEqual(unsupportedNumbers("1万2千人が遊んだ", "累計 2000人"), ["1万2千人"]);
  assert.deepEqual(unsupportedNumbers("1万2千人が遊んだ", "累計 12,000人"), []);
  // 「2万 300人」は、20300 ではなく、300人として読む
  assert.deepEqual(claimNumbers("2万 300人").map((x) => x.value), [300]);
});

test("数字の照らし合わせ: 1未満の実績の数字（0.5% など）も見る。0 と 1 だけは見ない", () => {
  assert.deepEqual(unsupportedNumbers("満足度0.5%アップ、0.8倍の手間", "材料"), ["0.5%", "0.8倍"]);
  assert.deepEqual(unsupportedNumbers("0人から始めて、1人でも", "材料"), []);
});
