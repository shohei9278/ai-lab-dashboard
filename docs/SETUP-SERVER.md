# ダッシュボードをサーバーに置く（PCを閉じていても動かす・ポートフォリオとして公開する）

今はこのPCの中で動いているダッシュボードを、Railway のサーバーに移します。移すと、次のようになります。

- PCを閉じていても、毎日の自動実行・5分ごとの取り込み・SNSへの投稿・判断が動く
- `https://〇〇.up.railway.app` を、だれでも**閲覧だけ**できる（ポートフォリオとして見せられる）
  - ボタンは見えるが、押すと「公開中のデモでは押せません」と出る。操作はサーバー側で全部断る
  - 連絡先・SNSのコメントの相手と本文・他人の投稿の本文・デザインの参考の画面・エラーの詳細は「デモ表示」で伏せる
- あなたは `/login` でパスワードを入れると、今までどおり全部の操作ができる（30日ログインのまま）
- データ（案件・費用の記録・画面の写真など）は、サーバーのボリューム（保存領域）に置く
- ツールの自動テストやページの画面の確認も、サーバーで動く（Chromium と日本語のフォントを入れてある）

費用の目安は月$5〜10です（Hobby プラン）。所要時間は30〜40分ほどです。

## 1. Railway のアカウントとプロジェクト

1. https://railway.com でアカウントを作り、**Hobby プラン**にする（GitHub アカウントで登録すると簡単）
2. ターミナルで次を実行してログインする（ブラウザが開きます）

```bash
cd "/Users/shoheinakahara/Dropbox/Mac/Desktop/案件/_repo/ai-lab" && npx @railway/cli login
```

3. プロジェクトを作る（名前は自由。例: ai-lab-dashboard）

```bash
npx @railway/cli init
```

4. 一度デプロイしてサービスを作る（`Dockerfile` を使って組み立てます。初回は10分ほどかかります。この時点では設定が足りないので、うまく動かなくて大丈夫です）

```bash
npx @railway/cli up
```

`data/`（今のデータ）・`.env.local`（キー）はサーバーに送りません（`.railwayignore` と `.dockerignore` で除外しています）。

## 2. Railway の管理画面での設定

できたサービスを開いて、次を設定します。

**ボリューム（データの保存領域）**
- サービスを右クリック（またはコマンドパレット）→ **Volume を追加**、マウント先は `/data`

**Settings**
- **Region**: 日本に近いもの（Asia の Singapore など）
- **Networking → Generate Domain** で `https://〇〇.up.railway.app` を作り、控える

**Usage Limits（使用量の上限）**
- 想定外の請求を防ぐため、上限を設定しておく（例: $15）

**Variables**（キーは `.env.local` と同じ値を入れる。チャットには貼らないでください）

| 名前 | 値 |
|---|---|
| `DASHBOARD_PASSWORD` | 運営者のログイン用のパスワード（20文字以上のランダムなもの。パスワード管理アプリで作るのがおすすめ）。**これを入れると、来た人は閲覧だけになります** |
| `ANTHROPIC_API_KEY` | `.env.local` と同じ |
| `OPENAI_API_KEY` | `.env.local` と同じ |
| `GEMINI_API_KEY` | `.env.local` と同じ |
| `SUPABASE_URL` | `.env.local` と同じ |
| `SUPABASE_SERVICE_ROLE_KEY` | `.env.local` と同じ |
| `X_API_KEY` / `X_API_SECRET` / `X_ACCESS_TOKEN` / `X_ACCESS_SECRET` | `.env.local` と同じ |
| `THREADS_ACCESS_TOKEN` | `.env.local` と同じ |
| `BLUESKY_HANDLE` / `BLUESKY_APP_PASSWORD` | `.env.local` と同じ |
| `NOTIFY_WEBHOOK_URL` | `.env.local` と同じ |

`AI_LAB_DB`（`/data/ai-lab.db`）と `TZ`（`Asia/Tokyo`）は `Dockerfile` で決めてあるので、入れなくて大丈夫です。

入れ終わると自動で再デプロイされます。`https://〇〇.up.railway.app` を開いて、上に「公開中のデモです」と出れば閲覧の側はOKです。`/login` で上のパスワードを入れて、その帯が消えれば運営者の側もOKです（この時点ではデータは空です）。

## 3. 今のデータをサーバーに移す

1. **このPCのダッシュボードを止める**（移している間にデータが変わらないようにするため。Claude に頼めば止めます。AIが作業中でないことを確かめてから止めます）
2. 次を実行し、聞かれたら `DASHBOARD_PASSWORD` を入力する（入力は画面に表示されません）

```bash
cd "/Users/shoheinakahara/Dropbox/Mac/Desktop/案件/_repo/ai-lab" && npx tsx scripts/push-db.mts https://〇〇.up.railway.app
```

3. 「DBを移しました」「画面の写真などのファイルを N件送りました」「完了しました」と出たら、サーバーのダッシュボードを開いて、案件や画面の写真が並んでいるか確かめる

サーバーにすでに実案件があるときは、上書きしないよう止まります。わざと上書きするときだけ、最後に `--force` を付けてください。

## 4. このPCの側を止める

サーバーとこのPCの両方で自動実行が動かないよう、このPCの `.env.local` に次の1行を足します。

```
AI_LAB_SCHEDULER=off
```

これ以降は、サーバーのダッシュボードを使ってください。このPCのダッシュボードを開いても古いデータのままなので、承認などはサーバーの方で行います。

## 5. 動作確認（Claude に「サーバーの動作確認して」と伝えてください）

- ログインせずに開いて、ボタンが押せないこと・伏せるべきものが伏せてあること
- ログインして、ホーム・判断待ち・設定が開けること、設定に「✓ Supabase に接続済み」が出ること
- 5分ほど待って、処理ログに取り込みの記録が出ること

## コードを変えたあと

```bash
cd "/Users/shoheinakahara/Dropbox/Mac/Desktop/案件/_repo/ai-lab" && npx @railway/cli up
```

で反映します。データはボリュームにあるので、デプロイしても消えません。AIが作業中のときにデプロイすると、その作業は途中で止まります（右下の「AIが作業中」が出ていないときに行ってください）。

## 注意

- パスワードを知っている人は、承認やAIの呼び出し（お金がかかる操作）ができます。パスワードは人に教えないでください
- 来た人に見せたくないものが新しく増えたときは、Claude に「デモ表示で伏せて」と伝えてください
