import assert from "node:assert/strict";
import { test } from "node:test";
import { recordView, type ViewStore } from "../lp-site/src/lp/trackView";

// lp_views の真似（列がないときは、送った列のうち、決めた順で最初の1つだけをエラーで返す）
function fakeStore(columns: string[], order: string[] = ["source", "inapp"]) {
  const rows: Record<string, unknown>[] = [];
  const store: ViewStore = {
    async insert(r) {
      const bad = order.find((c) => c in r && !columns.includes(c));
      if (bad) return { error: { message: `Could not find the '${bad}' column of 'lp_views' in the schema cache` } };
      if (!rows.some((x) => x.slug === r.slug && x.version === r.version && x.visitor_id === r.visitor_id)) rows.push({ inapp: null, source: null, ...r });
      return { error: null };
    },
    async fillInApp(key, inapp, source) {
      if (source !== undefined && !columns.includes("source")) return { error: { message: "column lp_views.source does not exist" } };
      for (const x of rows) {
        if (x.slug !== key.slug || x.version !== key.version || x.visitor_id !== key.visitor_id) continue;
        if (source !== undefined && (x.source ?? null) !== source) continue;
        if (x.inapp === null || (inapp && x.inapp === "")) x.inapp = inapp;
      }
      return { error: null };
    },
  };
  return { store, rows };
}
const row = { slug: "a", version: 1, visitor_id: "v", referrer: null };

test("inapp 列・source 列が両方ないときは、どちらの順でエラーが返っても、列なしで記録する", async () => {
  for (const order of [["source", "inapp"], ["inapp", "source"]]) {
    const { store, rows } = fakeStore([], order);
    assert.deepEqual(await recordView(store, row, "abcd", "x"), { error: null });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].source, null);
  }
});

test("片方の列だけないときは、その列だけを外す", async () => {
  const { store, rows } = fakeStore(["source"]);
  assert.deepEqual(await recordView(store, row, "abcd", "x"), { error: null });
  assert.equal(rows[0].source, "abcd");
  assert.equal(rows[0].inapp, null);
});

test("任意の列と関係のないエラーは、そのまま返す", async () => {
  const store: ViewStore = { insert: async () => ({ error: { message: "boom" } }), fillInApp: async () => ({ error: null }) };
  assert.deepEqual(await recordView(store, row, "abcd", "x"), { error: { message: "boom" } });
});

test("同じ日の再訪で、アプリの外だった記録をアプリの中に、分からなかった記録を判定済みに埋める（投稿への帰属は変えない）", async () => {
  const a = fakeStore(["source", "inapp"]);
  await recordView(a.store, row, "abcd", "");
  await recordView(a.store, row, "abcd", "instagram");
  assert.equal(a.rows.length, 1);
  assert.equal(a.rows[0].inapp, "instagram");
  // アプリの中だったものは、あとからアプリの外と判定されても変えない
  await recordView(a.store, row, "abcd", "");
  assert.equal(a.rows[0].inapp, "instagram");

  const b = fakeStore(["source", "inapp"]);
  await recordView(b.store, row, "abcd", null); // 古いページから
  await recordView(b.store, row, "abcd", "");
  assert.equal(b.rows[0].inapp, "");

  // 別の投稿のリンク・目印なしでの再訪では、最初の投稿の記録を書き換えない
  const c = fakeStore(["source", "inapp"]);
  await recordView(c.store, row, "abcd", "");
  await recordView(c.store, row, "efgh", "x");
  await recordView(c.store, row, null, "x");
  assert.equal(c.rows[0].source, "abcd");
  assert.equal(c.rows[0].inapp, "");
});

test("inapp 列だけがあるときも、目印なしの同じ日の再訪で、アプリの外だった記録をアプリの中に埋める", async () => {
  const { store, rows } = fakeStore(["inapp"]);
  await recordView(store, row, null, "");
  assert.equal(rows[0].inapp, "");
  assert.deepEqual(await recordView(store, row, null, "instagram"), { error: null });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].inapp, "instagram");
});
