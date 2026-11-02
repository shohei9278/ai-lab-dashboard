# LPを実際に公開するための準備

ダッシュボードで「公開」を承認すると、LPがインターネット上に公開され、訪問数と事前登録数が自動でダッシュボードに入るようにします。
アカウントの作成・秘密のキーの扱いは、ご自身で行ってください。所要時間は30〜60分ほどです。

```
ダッシュボード（このPC）──公開・数字の取り込み──▶ Supabase（データ）◀──読み書き── 公開用LPサイト（Vercel）◀── 訪問者
```

## 1. Supabase（データの保存先）

1. https://supabase.com でアカウントを作り、新しいプロジェクトを作る
   - Region は **Northeast Asia (Tokyo)** を選ぶ
   - データベースのパスワードは控えておく（この手順では使わない）
2. 左メニューの **SQL Editor** を開き、`supabase/schema.sql` の中身を貼り付けて **Run**
3. **Project Settings → API**（または Data API）で、次の2つを控える
   - Project URL（`https://xxxx.supabase.co`）
   - `service_role` の secret キー
   - ⚠ `service_role` キーは何でも読み書きできる秘密のキーです。チャット・GitHub・ブラウザ側のコードには絶対に出さないでください

## 2. 問い合わせ用のメールアドレス

プライバシーポリシーに載せる連絡先です。本名が出ないよう、このブランド専用のアドレス（例: Gmail で新しく作る）をおすすめします。

## 3. URL（まずはドメインなしでOK）

最初は Vercel が無料でくれる `https://プロジェクト名.vercel.app` を使います。訪問者に見えるので、4 で付けるプロジェクト名は屋号に合わせた中立的なもの（`ai` や `test` を含まない名前）にしてください。

独自ドメインはあとから追加できます（Vercel の **Domains → Buy**、または他社で買ったもの）。追加しても `.vercel.app` のURLはそのまま使えますが、広告やSNSに載せるURLはドメインに切り替える前提で、最初の広告を出す前に決めておくのがおすすめです。

## 4. Vercel（公開用LPサイト）

ターミナルで次を実行します（初回はブラウザでログインを求められます）。

```bash
cd "/Users/shoheinakahara/Dropbox/Mac/Desktop/案件/_repo/ai-lab/lp-site"
npx vercel
```

- 質問には基本的に Enter で進めて大丈夫です（プロジェクト名は自由）
- 終わったら Vercel の管理画面で、そのプロジェクトの **Settings → Environment Variables** に次を入れる

| 名前 | 値 |
|---|---|
| `SUPABASE_URL` | 1-3 の Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | 1-3 の service_role キー |
| `SITE_NAME` | 屋号・ブランド名（例: AI Product Lab） |
| `CONTACT_EMAIL` | 2 のメールアドレス |
| `POLICY_UPDATED` | プライバシーポリシーの制定日（例: 2026年11月1日） |

- 入れたら、本番に反映します

```bash
npx vercel --prod
```

- 表示された `https://プロジェクト名.vercel.app` を控える（独自ドメインを使うときは **Settings → Domains** で追加）

## 5. ダッシュボードとつなぐ

1. ダッシュボードの `.env.local` に、次の2行を足す（値は 1-3 と同じ）

```
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=（service_role キー）
```

2. ダッシュボードのサーバーを再起動する
3. ダッシュボードの **設定 → 公開用LPサイト** に、4 で控えたURL（例: `https://プロジェクト名.vercel.app`）を入れて保存する
   - 「✓ Supabase に接続済み」と出ればOK

## 6. 動作確認（ここまでできたら、Claude に「動作確認して」と伝えてください）

1. どれか1件の案件で「公開」を承認する → 経過に「LPを公開しました: https://…/p番号」と出る
2. そのURLを開く → LPが表示される
3. 自分のメールアドレスで事前登録してみる
4. 案件の画面で「数字を今すぐ取り込む」→ 訪問1・登録1 が入る
5. テストで登録した自分のメールは、Supabase の **Table Editor → signups** から削除しておく

## 7. Google アナリティクス（任意）

LPが「どこまで読まれたか」「登録ボタンが押されたか」をGAで見られるようにします。タグはサイト全体に1回入っているので、今後AIが作るLPにも自動で入ります。

1. https://analytics.google.com でプロパティを作る（タイムゾーン: 日本、通貨: 日本円）
2. **データストリーム → ウェブ** で `https://〇〇.vercel.app` を追加し、**測定ID（G-XXXXXXXXXX）** を控える
   - 「拡張計測機能」はオンのままでOK（ページビュー・スクロールなどが自動で取れます）
3. Vercel の環境変数に `GA_MEASUREMENT_ID` として測定IDを入れ、`POLICY_UPDATED` を今日の日付に変える（プライバシーポリシーにGAの説明が自動で追加されるため）
4. `npx vercel --prod` で本番に反映する
5. GA の **管理 → イベント**（または「キーイベント」）で、`sign_up` を**キーイベント**にする（登録完了を成果として数えるため）
6. 案件ごとに分けて見たいときは、**管理 → カスタム定義** でイベントパラメータ `lp_slug` と `section` をカスタムディメンションとして登録する

LPから送るイベント:

| イベント | いつ | 中身 |
|---|---|---|
| `page_view` | ページを開いたとき（GAが自動で送る） | ページのURL（/p番号） |
| `section_view` | 悩み・特徴・よくある質問・登録フォームの各部分が半分見えたとき | `section`（pains / features / faq / signup） |
| `cta_click` | ページ上部の登録ボタンを押したとき | |
| `form_start` | メール欄に初めて入力しようとしたとき | |
| `sign_up` | 登録が完了したとき | |
| `sign_up_error` | 登録に失敗したとき | |

どのイベントにも `lp_slug`（p番号）と `lp_version`（LPの版）が付きます。メールアドレスは送りません。

## 公開前に確認しておくこと

- **プライバシーポリシー**（`lp-site/src/app/privacy/page.tsx`）の内容。必要なら専門家に相談してください
- 登録者にメールを送るときは、特定電子メール法に沿って、送信者名・連絡先・配信停止の方法を必ず書く
- 広告を出す場合は、広告の管理画面でも予算の上限を必ず設定する（ダッシュボードの上限は、広告を止めることはできません）
