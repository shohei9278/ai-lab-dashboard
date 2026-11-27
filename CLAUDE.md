# ai-lab（AI Product Lab）で作業するときの決まり

Claude・GPT・Gemini を社員にした会社の実験のダッシュボード（Next.js と SQLite）。本番は Railway。
`lp-site/` は、AIが作ったツールと事前登録のページを並べる公開サイト（Hitoride、Vercel）。

Next.js の注意（`next dev` が自動で作り、消しても作り直す。Next.js のコードを書く前に読む）:
@AGENTS.md

## 進め方
- main に直接 push しない。ブランチで作業して PR を作る
- コミット・push・PRの作成・マージは、運営者が言った範囲だけ行う。「確認して」はコミットの了承ではない
  - 「コミットして」はコミットだけ。「pushして」「コミットしてpush」はpushまで（PRがすでにあるブランチなら、pushでPRに入る）
  - 「PRを作って」「コミットしてデプロイ」は、コミット・push・PRの作成まで。マージはしない
  - 本番に出す（マージする）のは「マージして」と言われてから
  - 運営者が Auto-fix をオンにしたPRでは、CIの失敗・競合・レビューの指摘の直しを、聞かずにそのPRのブランチへコミットしてpushしてよい（マージはしない）
- マージは通常のマージ（スカッシュしない）。人の手の記録がコミットIDにリンクしているため
- 提案箱のルーティンが作った PR（`claude/proposal-<番号>`）は、自動マージ（`.github/workflows/auto-merge.yml`・`scripts/auto-merge.ts`）が、CI と GPT・Gemini のレビューを見てマージする（運営者が決めた。手順は `docs/SETUP-AI-FIX.md`）。このセッションの Claude Code が作る PR は、これまでどおり運営者が言った範囲だけ
- コミットの末尾に `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`、PR本文の末尾に `🤖 Generated with [Claude Code](https://claude.com/claude-code)`
- 作業の中で、note の記事の話になりそうな出来事（人が直す必要があった・思ったように効かなかった・AI が自分で判断を変えた・仕組みが思わぬ所で止まった・間違えた・AI どうしや AI と人で判断が割れた・数字がはっきり動いた・人の出番が変わった）があったら、その作業の PR に「話の種」を1件1ファイルで足す（`docs/stories/`。書き方は `docs/stories/README.md`。運営者が決めた）。事実だけを短く書き、感想は書かない。AIに渡していた指示（人が先に決めていたこと）は、指示を読んで書く。最後に「AIと仕事をして分かった、明日変えられること」を1文で書く（常識で分かることなら「なし」）。記事の下書きのルーティンが毎朝読み、その1文が書けて常識でない話があるときだけ1つ選んで書く（なければ書かない）
- 人が見つけた不具合や、人の判断が入った変更の PR には、`src/data/interventions/<key>.json` に「改善の記録」の人の記録を1件1ファイルで足す（`src/lib/interventions.ts` の `FIRST` には足さない。PR を並べたときにぶつからないように）。中身の形は、同じフォルダのほかのファイルに合わせる。人が実際に言ったこと・決めたことだけを書き、言っていない判断を書かない。自動のテストやCIが見つけた不具合には足さない。運営者が画面で直した記録は、`FIRST` を書き換えても上書きされない

## 確かめること
- ダッシュボード: `npm run typecheck`、`npm run lint`、`npm test`（来訪者の画面は `npm run test:e2e`）
- 公開サイト: `cd lp-site && npx tsc --noEmit && npm run lint`
- 画面が変わるときは、PCとスマホの幅で画面を撮って確かめる
- 外から入れたスキル（`.claude/skills`）の出どころは `.claude/skills/SOURCES.md`。更新するときは、取り直した差分を読んでから入れ替える

## マージの前
- PR のチェック（CI と ai-review）が通っていること
- ai-review は、別のAI（GPT）のレビューを PR のコメントに書く。PR の説明文を「要件」として読むので、途中で方針が変わったら説明文を今の形に直す（古い説明文のままだと、決めて変えた点を「要件と違う」と指摘される）
- 本番がいま動いていないこと。本番の `/api/live` で `activities` と `building` が空なら動いていない（`building` には、クラウドの Claude Code のルーティンが作業中の開発待ちも入る。`activities` には、名前の付いた作業がないときに、AIを呼んでいる途中のもの（朝の計画・日報・自動投稿など）も入る）
  - 本番: https://ai-lab-dashboard-production-fc9e.up.railway.app
- push するたびにチェックとレビューがやり直しになる。CI の結果を繰り返し見に行かない（終わるのを待つときは、運営者に伝えて止まる）

## 本番に出す
- マージから本番の確認までの順番は、スキル `ai-lab-ship`（`.claude/skills/ai-lab-ship`）にまとめてある。画面を手元で撮って確かめる手順は `ai-lab-screen-check`
- ダッシュボード: main にマージすると Railway が自動で出す。始まらないときは Railway の「Deploy latest commit」
- 本番の確認（`.github/workflows/smoke.yml`）が、出したあとと30分ごとに、主要ページが 200 を返すか・来訪者の操作が 403 か・main の最新が本番に出ているかを見る
  - マージの直後に2回続けて失敗し、直前の版では成功していたら、自動の戻し（`.github/workflows/auto-revert.yml`）が、そのマージを元に戻す PR を作ってマージする（手順は `docs/SETUP-AI-FIX.md`）
  - ページのURLを消す・移す・名前を変えるときは、smoke.yml の一覧も一緒に直す（`/live` をホームへ移したとき、ここを直し忘れて失敗が続いた）
- 公開サイト（https://hitoride.vercel.app）は、main にマージして CI が通ると、`.github/workflows/lp-deploy.yml` が自動で Vercel に出す（前に出した版から `lp-site/` が変わったときだけ。出した・失敗したは Discord に知らせる）
  - 自動で出なかった・急ぐときは、Actions の「公開サイトを出す」を手で動かす（main で CI が成功したいちばん新しい版を出す）。それもできないときだけ、main の最新にそろえた手元で `cd lp-site && npx vercel deploy --prod --yes`
  - 出たかは、Discord の知らせ（または `npx vercel inspect <出たURL>` の status）と、ブラウザで一度開いて確かめる
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
