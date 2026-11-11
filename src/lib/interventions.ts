import { db } from "./db";
import { jstDay } from "./sns";

// 人の手の記録: AIに任せきりではなく、人がどこで問題を見つけ、何を決めたのかを、AIがやったことと分けて公開する
// - 開発・保守への介入: このページの事例（手で書く）
// - AIの事業運営への介入: 処理の記録から自動で数える（operationCounts）

export type InterventionKind = "bug" | "design" | "direction";
export const INTERVENTION_KIND: Record<InterventionKind, string> = { bug: "不具合", design: "仕組みの変更", direction: "方針の判断" };

// 問題を最初に見つけたのは誰（何）か。同じ問題を複数で見つけることもある
export const FOUND_BY = { human: "人", gpt: "GPTのレビュー", test: "自動テスト", release: "公開後" } as const;
export type FoundBy = keyof typeof FOUND_BY;

// 列の意味: happened = 問題 / noticed = 人の対応 / decision = AIの対応 / result = 修正後の結果
export type InterventionRow = { id: number; day: string; kind: InterventionKind; title: string; happened: string; noticed: string; decision: string; result: string | null; found_by: string | null; commit_sha: string | null };

export const commitUrl = (sha: string) => `https://github.com/shohei9278/ai-lab-dashboard/commit/${sha}`;
const isFoundBy = (k: unknown): k is FoundBy => typeof k === "string" && Object.hasOwn(FOUND_BY, k);
export const foundByLabels = (v: string | null) => (v ?? "").split(",").filter(isFoundBy).map((k) => FOUND_BY[k]);

// これまでの実際の事例。key ごとにコードの内容で更新するので、文面やコミットを直せば次の起動で反映される（消した記録は消したまま）
const FIRST: (Omit<InterventionRow, "id"> & { key: string })[] = [
  { key: "offsite-backup", day: "2026-11-10", kind: "design", title: "データベースの写しを外部にも残すようにした", happened: "毎日の写しはデータベースと同じ保存場所にしかなく、保存場所ごと失うと写しも一緒に消える状態だった。", noticed: "優先度の表でバックアップの確認を挙げ、保存先を Supabase に決めた。", decision: "Claude Codeが、毎日の写しを圧縮して Supabase の非公開の保存領域へ送り、30日分残す形にした。失敗したらエラーの通知が届くようにした。", result: "データのコピーで、送信・非公開であること・取り出して開けることを確かめた。本番の写しが届くかはまだ確かめていない。", found_by: "human", commit_sha: "d6ff709" },
  { key: "guest-drafts", day: "2026-11-10", kind: "bug", title: "投稿前の下書きが来訪者にも見えていた", happened: "発信の下書きのページで、noteの記事と個人アカウント用の投稿の下書きが、ログインしていない人にも表示されていた。", noticed: "全ページをAIに見せることを決め、報告を読んで直すと判断した。", decision: "Claude Codeが来訪者の画面を確認して見つけ、下書きのデータを運営者にだけ渡す形に直した。", result: "本番で、来訪者には下書きが送られないことを確かめた。運営者に表示されることは手元で確かめた。", found_by: "release", commit_sha: "c747248" },
  { key: "mobile-tables", day: "2026-11-10", kind: "bug", title: "スマホで表の列が押しつぶされていた", happened: "概要ページや集客のページなど9ページの表で、スマホ幅になると列が縮み、文字が1〜3字ずつ折り返されていた。", noticed: "「特にスマホ表示が怪しい箇所がある」と伝えて全ページをAIに見せることを決め、報告を読んで表から直すと判断した。", decision: "Claude Codeが全ページの画面を撮って崩れを洗い出し、主要な表はスマホだけカード形式に、列の多い表は横スクロールで読める形に直した。", result: "本番で、スマホ幅（375px・320px）で列がつぶれないことを確かめた。PC幅の表示は手元で確かめた。", found_by: "human,release", commit_sha: "3e95f22" },
  { key: "showcase-sidebar", day: "2026-11-10", kind: "bug", title: "概要ページからダッシュボードに移るとサイドバーが出なかった", happened: "公開の概要ページ（/showcase）からリンクでダッシュボードに移ると、サイドバーが表示されなかった。", noticed: "本番の画面で気づき、レイアウトの該当コードを示して「一旦判定したままになってそう」と原因の見当を伝えた。", decision: "Claude Codeが、ルートのレイアウトはページを移っても作り直されないことを確かめ、ページの判定を画面側に移した。", result: "本番で、概要ページとダッシュボードの行き来でサイドバーが正しく出し分けられることを確かめた。", found_by: "human,release", commit_sha: "7de6f71" },
  { key: "external-font", day: "2026-11-10", kind: "design", title: "ダッシュボードの外部フォントをやめた", happened: "ビルドの失敗を避けるためにGoogleフォントをブラウザから読む形にしたところ、閲覧者の情報がGoogleに送られるようになった。", noticed: "GPTの指摘を読み、外部フォントの読み込みを外すと決めた。", decision: "GPTがコードレビューで問題を指摘した。Claude Codeが、端末やサーバーに入っているフォントを使う形に直した。", result: "ダッシュボードから外部のフォントを読まなくなった。", found_by: "gpt", commit_sha: "dfb2c61" },
  { key: "tool-review-false-alarm", day: "2026-11-10", kind: "bug", title: "ツール本体が消えたとAIが誤って報告していた", happened: "ツールの新しい版を確かめるとき、文章を見るAIに「ツール本体のない今の文章」と「本体のある前の版」を比べさせていたため、本体がなくなったと誤って報告し、問題のない版が人の確認に回っていた。", noticed: "キーキャップ配色ためし塗りの報告を見て「不具合の原因探りたい」と調査を指示した。", decision: "Claude Codeが処理を調べて原因を見つけ、比べる材料からツール本体を外した。", result: "テストで、比べる材料にツール本体が入らないことを確かめた。本番で誤報告が止まったかはまだ確かめていない。", found_by: "human,release", commit_sha: "4dbe25f" },
  { key: "ci-font-build", day: "2026-11-10", kind: "bug", title: "ビルドがGoogleフォントの取得で失敗していた", happened: "初めて動かしたCIのビルドが、Googleフォントの取得の処理で止まった。Railwayのビルドの失敗も同じ原因の可能性が高い。", noticed: "CIを入れると決め、修正をPRに反映することを判断した。", decision: "Claude Codeがログを読んで原因を調べ、ビルドのときにフォントを取りに行かない形に直した。", result: "同じPRのCIが通るようになった。", found_by: "test", commit_sha: "922bb71" },
  { key: "count-mismatch", day: "2026-11-10", kind: "bug", title: "集客の件数が 4/3件 になっていた", happened: "投稿の上限より実際の件数が多く見える表示になっていた。", noticed: "画面を見て「集客のところ直近24時間 4/3件みたいなテキストになるんだけど分母と分子あってる？」と指摘した。", decision: "Claude Codeが、分母が古い設定のままで分子も実際の判定と数え方が違うことを調べ、上限の判定を1か所にまとめた。計画がない日の食い違いは、Claude Codeのコードレビューで見つけて直した。", result: "本番の表示が 1/10、5/10 のように、実際に投稿を止める上限と同じ基準になった。", found_by: "human,release", commit_sha: "e3c21d8" },
  { key: "real-screen-video", day: "2026-11-09", kind: "direction", title: "字幕の動画より、本物の画面を見せる", happened: "AIが台本を書いた字幕だけの動画を作れるようにしたが、普通のテキスト動画に見えた。", noticed: "見本を見て「もっとダッシュボードの動きとか見せられた動画とかの方が面白そうだけどね」と提案し、作ることを決めた。", decision: "Claude Codeが、ゲスト用の本物の画面を順に映す動画を作れるようにした。字幕の数字は記録から入れ、台本にAIは使わない。", result: "手元で動画を作って確認した。投稿したときの効果はまだ測っていない。", found_by: "human", commit_sha: "3120b11" },
  { key: "video-memory", day: "2026-11-09", kind: "bug", title: "本番のサーバーで動画を作れなかった", happened: "手元では動いた動画の変換が、本番ではエラーで止まった。", noticed: "本番のボタンを押してエラーを見つけ、調査と修正を指示した。", decision: "Claude Codeが原因をメモリ不足と推定し（ログに決め手はなし）、変換の設定を見直して、変換の前にブラウザを閉じるようにした。", result: "使用メモリのピークが約720MBから約130MBに減った（手元での測定、約81%減）。修正後は本番で動画を作成できた。", found_by: "human,release", commit_sha: "5d50a0a" },
  { key: "notify-diary", day: "2026-11-09", kind: "design", title: "通知を「やったこと」だけにし、日報とまとめを1つにした", happened: "Discordに「これから」の通知が流れ、夜の日報と1日のまとめも別の処理で別の時刻に動いていた。", noticed: "「discordのこれからって投稿いらない」「そもそも日報とまとめの処理一緒で良いのでは」と指摘した。", decision: "Claude Codeが、始めるときの通知をやめ、夜の処理を「日報を書いて、そのままDiscordに送る」1つにした。", result: "本番に反映した。日報入りのまとめが届いたかは、まだこの記録では確かめていない。", found_by: "human", commit_sha: "c01f40a" },
  { key: "new-axis", day: "2026-11-09", kind: "design", title: "AIに「別軸」の提案もさせる", happened: "提案箱に入るのは今のやり方の改善ばかりで、動画のような新しい手はAIから出ていなかった。", noticed: "「こういう提案も提案箱に入るようになると良いな」と指摘した。", decision: "Claude Codeが、定例会議で、まだ試していない手を別の基準で採点し、一番良いものを1件は提案箱に入れるようにした。", result: "データの写しで、3社すべてが別軸の案を出すことを確かめた。本番の定例会議の結果はまだ出ていない。", found_by: "human", commit_sha: "c01f40a" },
  { key: "tool-cut-53", day: "2026-11-09", kind: "bug", title: "ツール作成が途中で切れて、1回で約96円が無駄になった", happened: "案件#53のコードを書くAIが、出力の上限まで使い切って止まった。", noticed: "「あと53の案件がまた 出力が長すぎて途中で切れましたになった」と失敗を報告し、調査を指示した。", decision: "Claude Codeが、上限が6.4万トークンまで使い切られたことを調べ、上限を下げて、切れたら別の会社のAIに規模を絞って1回だけ書き直させるようにした。", result: "引き継ぎの動きはテストで確かめた。本番で同じ失敗が起きたときの動作はまだ確かめていない。", found_by: "human,release", commit_sha: "58b8fd9" },
  { key: "hold-status", day: "2026-11-09", kind: "design", title: "案件に「保留」を作った", happened: "季節もののように今は集客しても届かない案件も、撤退か継続かの判断に進んでしまう作りだった。", noticed: "「案件の保留ってステータスは必要だと思う？」と問いかけ、提案された形で作ることを決めた。", decision: "Claude Codeが、公開と記録は続けて宣伝・判断・改善だけを止める形を提案して作った。保留にできるのは人だけにした。", result: "本番に反映した。実際の案件で使った結果はまだない。", found_by: "human", commit_sha: "58b8fd9" },
  { key: "improve-cut-36", day: "2026-11-09", kind: "bug", title: "ツールの改善が失敗し、約59円が2回無駄になった", happened: "案件#36の改善で、処理が失敗して費用だけがかかった。", noticed: "失敗を見て「以下失敗の原因は？ 他の処理とぶつかったかな」と調査を指示した。", decision: "Claude Codeが、文章を直すAIにツールのプログラム全文を渡していて出力が切れていたことを調べ、シェア文だけ引き継ぐようにした。", result: "同じ処理の費用が約59円から約9円になった。", found_by: "human,release", commit_sha: "6c5a8d5" },
  { key: "mobile-overflow", day: "2026-11-06", kind: "bug", title: "スマホで画面が横にはみ出していた", happened: "ダッシュボードの一部がスマホ幅で横にはみ出し、スクロールが必要になっていた。", noticed: "「ダッシュボードのスマホ表示が横スクロールしちゃったりしてきになる」と指摘した。", decision: "Claude Codeが、幅の計算と長い文字の折り返しを直した。", result: "スマホ幅で横にはみ出さないことを確かめた。", found_by: "human,release", commit_sha: "3bb115d" },
  { key: "three-company-ideas", day: "2026-11-05", kind: "direction", title: "アイデア出しを3社の競争にした", happened: "設定した1社のAIだけがアイデアを出していて、会社どうしを比べられなかった。", noticed: "「AIにアイデアを出させるって 設定したAIだけが思考するっけ？」と問いかけ、選択肢を比べて3社方式に決めた。", decision: "Claude Codeが、Claude・GPT・Geminiが案を出し、作者を伏せて採点し合う形に変えた。", result: "本番で運用している。", found_by: "human", commit_sha: "29973d3" },
];

const g = globalThis as unknown as { __aiLabInterventionsSeeded?: boolean };

function seedOnce() {
  if (g.__aiLabInterventionsSeeded) return;
  const update = db().prepare("UPDATE interventions SET day = ?, kind = ?, title = ?, happened = ?, noticed = ?, decision = ?, result = ?, found_by = ?, commit_sha = ? WHERE seed_key = ?");
  const insert = db().prepare("INSERT INTO interventions (day, kind, title, happened, noticed, decision, result, found_by, commit_sha, seed_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  db().transaction(() => {
    for (const x of [...FIRST].reverse()) {
      const v = [x.day, x.kind, x.title, x.happened, x.noticed, x.decision, x.result, x.found_by, x.commit_sha, x.key];
      if (!update.run(...v).changes) insert.run(...v);
    }
  })();
  g.__aiLabInterventionsSeeded = true;
}

export function listInterventions(limit = 200): InterventionRow[] {
  seedOnce();
  return db().prepare("SELECT * FROM interventions WHERE hidden = 0 ORDER BY day DESC, id DESC LIMIT ?").all(limit) as InterventionRow[];
}

export function addIntervention(v: Record<string, unknown>): number {
  const text = (k: string, max: number) => String(v[k] ?? "").trim().slice(0, max);
  const title = text("title", 80), happened = text("happened", 400), noticed = text("noticed", 300), decision = text("decision", 400), result = text("result", 300), sha = text("commit", 40);
  const kind = (["bug", "design", "direction"].includes(String(v.kind)) ? v.kind : "bug") as InterventionKind;
  const found = [...new Set((Array.isArray(v.found_by) ? v.found_by : []).filter(isFoundBy))];
  if (!title || !happened || !noticed || !decision) throw new Error("題・問題・人の対応・AIの対応は、すべて書いてください");
  if (sha && !/^[0-9a-f]{7,40}$/.test(sha)) throw new Error("コミットは英数字のIDで入れてください");
  seedOnce();
  return Number(db().prepare("INSERT INTO interventions (day, kind, title, happened, noticed, decision, result, found_by, commit_sha) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(jstDay(), kind, title, happened, noticed, decision, result || null, found.join(",") || null, sha || null).lastInsertRowid);
}

export function hideIntervention(id: number) {
  db().prepare("UPDATE interventions SET hidden = 1 WHERE id = ?").run(id);
}

// AIの事業運営に人が介入した回数（処理の記録から数える。デモの案件は入れない）
const OPERATION_KINDS: { label: string; kinds: string[] }[] = [
  { label: "AIの提案を承認・却下", kinds: ["approval"] },
  { label: "公開後に評価", kinds: ["human-review"] },
  { label: "公開を止めた", kinds: ["stop"] },
  { label: "修正やデザインを指示", kinds: ["revise-request", "auto-fix", "page", "lp-switch"] },
  { label: "案件を保留にした", kinds: ["hold"] },
  { label: "SNSに手で投稿・返信", kinds: ["sns-post", "sns-reply"] },
];

export function operationCounts(): { label: string; n: number }[] {
  const rows = db().prepare("SELECT e.kind, COUNT(*) AS n FROM events e JOIN projects p ON p.id = e.project_id WHERE e.actor = 'human' AND p.demo = 0 GROUP BY e.kind").all() as { kind: string; n: number }[];
  const count = new Map(rows.map((r) => [r.kind, r.n]));
  return OPERATION_KINDS.map((g) => ({ label: g.label, n: g.kinds.reduce((s, k) => s + (count.get(k) ?? 0), 0) }));
}
