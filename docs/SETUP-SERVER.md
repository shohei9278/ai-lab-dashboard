# ダッシュボードをサーバーに置く（PCを閉じていても動かす）

今はこのPCの中で動いているダッシュボードを、Railway のサーバーに移します。移すと、次のようになります。

- PCを閉じていても、毎日の自動実行と15分ごとの数字の取り込みが動く
- スマホなどから `https://〇〇.up.railway.app` で見られる。パスワードを知っている人だけが開ける
- データ（案件・承認・費用の記録など）は、サーバーのボリューム（保存領域）に置く

費用の目安は月$5前後です（Hobby プラン。使った分がこれを超えると追加で請求されます）。所要時間は30分ほどです。

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

4. 一度デプロイしてサービスを作る（この時点では設定が足りないので、うまく動かなくて大丈夫です）

```bash
npx @railway/cli up
```

`data/`（今のデータ）・`.env.local`（キー）・`lp-site/` はサーバーに送りません（`.gitignore` と `.railwayignore` で除外しています）。

## 2. Railway の管理画面での設定

できたサービスを開いて、次を設定します。

**ボリューム（データの保存領域）**
- サービスを右クリック（またはコマンドパレット）→ **Volume を追加**、マウント先は `/data`

**Settings**
- **Region**: 日本に近いもの（Asia の Singapore など）
- **Networking → Generate Domain** で `https://〇〇.up.railway.app` を作り、控える

**Variables**（キーは `.env.local` と同じ値を入れる。チャットには貼らないでください）

| 名前 | 値 |
|---|---|
| `DASHBOARD_PASSWORD` | ログイン用のパスワード（20文字以上のランダムなもの。パスワード管理アプリで作るのがおすすめ） |
| `AI_LAB_DB` | `/data/ai-lab.db` |
| `TZ` | `Asia/Tokyo` |
| `ANTHROPIC_API_KEY` | `.env.local` と同じ |
| `OPENAI_API_KEY` | `.env.local` と同じ |
| `GEMINI_API_KEY` | `.env.local` と同じ |
| `SUPABASE_URL` | `.env.local` と同じ |
| `SUPABASE_SERVICE_ROLE_KEY` | `.env.local` と同じ |

入れ終わると自動で再デプロイされます。`https://〇〇.up.railway.app` を開いて、ユーザー名 `admin` と上のパスワードでログインできればOKです（この時点ではデータは空です）。

## 3. 今のデータをサーバーに移す

1. **このPCのダッシュボードを止める**（移している間にデータが変わらないようにするため。Claude に頼めば止めます）
2. 次を実行し、聞かれたら `DASHBOARD_PASSWORD` を入力する（入力は画面に表示されません）

```bash
cd "/Users/shoheinakahara/Dropbox/Mac/Desktop/案件/_repo/ai-lab" && npx tsx scripts/push-db.mts https://〇〇.up.railway.app
```

3. 「完了しました。サーバーの案件: N件」と出たら、サーバーのダッシュボードを開いて、案件が並んでいるか確かめる

サーバーにすでに実案件があるときは、上書きしないよう止まります。わざと上書きするときだけ、最後に `--force` を付けてください。

## 4. このPCの側を止める

サーバーとこのPCの両方で自動実行が動かないよう、このPCの `.env.local` に次の1行を足します。

```
AI_LAB_SCHEDULER=off
```

これ以降は、サーバーのダッシュボードを使ってください。このPCのダッシュボードを開いても古いデータのままなので、承認などはサーバーの方で行います。

## 5. 動作確認（Claude に「サーバーの動作確認して」と伝えてください）

- ホーム・承認待ち・設定が開けるか
- 設定に「✓ Supabase に接続済み」が出るか
- 15分ほど待って、処理ログに取り込みの記録が出るか

## コードを変えたあと

```bash
cd "/Users/shoheinakahara/Dropbox/Mac/Desktop/案件/_repo/ai-lab" && npx @railway/cli up
```

で反映します。データはボリュームにあるので、デプロイしても消えません。

## ツールの自動テストについて

動くツールを公開する前のブラウザでの自動テストは、Chrome が入っている環境でだけ動きます。Railway のサーバーには Chrome が無いので、テストは飛ばされ、案件の画面に「自動テストを飛ばしました」と出ます（AIによるコードの確認は行われます）。
サーバーでもテストしたいときは、Railway の Variables に `CHROMIUM_PATH`（Chromium の場所）を入れ、ビルド時に Chromium を入れる設定が必要です。必要になったら Claude に相談してください。

## 注意

- パスワードを知っている人は、承認やAIの呼び出し（お金がかかる操作）ができます。パスワードは人に教えないでください
- Railway の管理画面で **Usage Limits（使用量の上限）** を設定しておくと、想定外の請求を防げます
