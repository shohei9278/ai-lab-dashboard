# ai-lab（AI Product Lab）で作業するときの決まり

Claude・GPT・Gemini を社員にした会社の実験のダッシュボード（Next.js と SQLite）。本番は Railway。
`lp-site/` は、AIが作ったツールと事前登録のページを並べる公開サイト（Hitoride、Vercel）。

## 進め方
- main に直接 push しない。ブランチで作業して PR を作る
- コミット・push・マージは、運営者が言ったときだけ。「確認して」はコミットの了承ではない
- 「コミットして」「pushして」「デプロイして」と言われたら、PRまで作る（PRの作成に別の指示は要らない）。本番に出すのは「マージして」と言われてから
- マージは通常のマージ（スカッシュしない）。人の手の記録がコミットIDにリンクしているため
- コミットの末尾に `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`、PR本文の末尾に `🤖 Generated with [Claude Code](https://claude.com/claude-code)`
- 人が見つけた不具合や、人の判断が入った変更の PR には、`src/lib/interventions.ts` の `FIRST` に「人の手の記録」を1件足す。人が実際に言ったこと・決めたことだけを書き、言っていない判断を書かない。自動のテストやCIが見つけた不具合には足さない

## 確かめること
- ダッシュボード: `npm run typecheck`、`npm run lint`、`npm test`（来訪者の画面は `npm run test:e2e`）
- 公開サイト: `cd lp-site && npx tsc --noEmit && npm run lint`
- 画面が変わるときは、PCとスマホの幅で画面を撮って確かめる

## マージの前
- PR のチェック（CI と ai-review）が通っていること
- ai-review は、別のAI（GPT）のレビューを PR のコメントに書く。PR の説明文を「要件」として読むので、途中で方針が変わったら説明文を今の形に直す（古い説明文のままだと、決めて変えた点を「要件と違う」と指摘される）
- 本番がいま動いていないこと。本番の `/api/live` で `activities` と `building` が空なら動いていない
  - 本番: https://ai-lab-dashboard-production-fc9e.up.railway.app
- push するたびにチェックとレビューがやり直しになる。CI の結果を繰り返し見に行かない（終わるのを待つときは、運営者に伝えて止まる）

## 本番に出す
- ダッシュボード: main にマージすると Railway が自動で出す。始まらないときは Railway の「Deploy latest commit」
- 本番の確認（`.github/workflows/smoke.yml`）が、出したあとと30分ごとに、主要ページが 200 を返すか・来訪者の操作が 403 か・main の最新が本番に出ているかを見る
  - ページのURLを消す・移す・名前を変えるときは、smoke.yml の一覧も一緒に直す（`/live` をホームへ移したとき、ここを直し忘れて失敗が続いた）
- 公開サイト（https://hitoride.vercel.app）は、main にマージしても出ない。マージのあと、main の最新にそろえた手元で次を実行する
  ```
  cd lp-site && npx vercel deploy --prod --yes
  ```
  - 出たかは `npx vercel inspect <出たURL>` の status と、ブラウザで一度開いて確かめる
  - curl などで短い間隔で何度も読みに行かない。Vercel の防御（Security Checkpoint）に機械的なアクセスと見なされ、403 の確認画面を返されるようになる

## 来訪者（ログインしていない人）
- ダッシュボードは、来訪者にも閲覧だけ見せている（ポートフォリオとして）。来訪者の GET 以外の呼び出しは、入口（`src/proxy.ts`）ですべて 403 にしている
- 下書き・AIの入出力・個人の情報・他人の投稿は、来訪者に見せない（SNSのコメントや返信の案は伏せる。`maskFeedForGuest` など）
- 見るだけで何も変えないボタン（タブの切り替え・再生など）には `data-demo-ok` を付ける。付けないと、来訪者の画面では押せなくなる（`GuestGuard`）

## 手元で動かすとき
- `AI_LAB_SCHEDULER=off` を付けて起動する（付けないと、自動実行が手元でも動く）
- 本番のデータの写しを使うときは `AI_LAB_DB` で指し、確かめ終わったら写しを消す
- AIを呼ぶ操作（会議・アイデア出し・比較など）はお金がかかるので、確かめのために勝手に押さない

## 秘密の値
- APIキーなどは `.env.local`・Railway の変数・GitHub の Secrets にだけ置く。会話や画面に値を出さない
