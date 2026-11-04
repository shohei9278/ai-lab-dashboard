# SNSへの自動投稿の準備（X・Threads・Bluesky）

公開中の案件を、AIが自動で投稿できるようにします。キーを入れた場所にだけ投稿します。キーはご自身で発行し、チャットには貼らないでください。
確認は `npx tsx --env-file=.env.local scripts/check-sns.mts`（各サービスにログインできるかだけを見ます。投稿はしません）。

# X

## X-1. アカウント側
1. 投稿に使うアカウント（@hitoride_app）でログインする
2. **設定 → アカウント情報 → 自動化** で、運営者のアカウント（あなたの個人アカウント）を管理者として登録し、「自動化されたアカウント」のラベルを付ける
   - X のルールで、自動で投稿するアカウントにはこのラベルが必要です

## X-2. API のキー
1. https://console.x.com（Developer Console）に @hitoride_app でログインし、アプリを作る
2. アプリの **User authentication settings** で、権限（App permissions）を **Read and write** にする
3. **Keys and tokens** で、次の4つを発行する（権限を変えたあとに発行し直すこと）
   - API Key / API Key Secret（Consumer Keys）
   - Access Token / Access Token Secret（@hitoride_app のもの）
4. 従量課金のクレジットを買う。リンク付きの投稿は1件 $0.20 です（1日2件なら月 約$12）。**使いすぎないよう、Console の上限（spend cap）も設定**してください

## X-3. ダッシュボードに入れる
`.env.local`（サーバーでは Railway の Variables）に4行を足して、サーバーを再起動します（「（ここに…）」の部分を丸ごと値に置き換える。確認は `npx tsx --env-file=.env.local scripts/check-x.mts`）。

```
X_API_KEY=（ここにコンシューマーキー）
X_API_SECRET=（ここにコンシューマーシークレット）
X_ACCESS_TOKEN=（ここにアクセストークン）
X_ACCESS_SECRET=（ここにアクセストークンシークレット）
```



# Threads（無料）

1. Threads のアカウントを用意する（Instagram のアカウントと紐づきます。運営用のものがおすすめ）
2. https://developers.facebook.com でアプリを作り、ユースケースに **「Threads APIにアクセス」** を選ぶ
3. 権限に **threads_basic** と **threads_content_publish** を足す
4. **アプリの役割 → 役割** で、投稿に使う Threads のアカウントを「Threadsテスター」として追加し、Threads のアプリの **設定 → アカウント → ウェブサイトのアクセス許可** で招待を承認する（自分のアカウントにだけ投稿するので、アプリの審査は不要です）
5. **Threads APIの使用事例 → 設定** の「ユーザートークン生成ツール」で、そのアカウントの **アクセストークン** を発行する（長期のトークン。60日で切れますが、ダッシュボードが期限の前に自動で延長します）
6. `.env.local` に1行足して、サーバーを再起動する

```
THREADS_ACCESS_TOKEN=（ここにアクセストークン）
```

# Bluesky（無料）

1. https://bsky.app で運営用のアカウントを作る（例: hitoride.bsky.social）
2. **設定 → プライバシーとセキュリティ → アプリパスワード** で、新しいアプリパスワードを作る（ログイン用のパスワードではなく、こちらを使います）
3. プロフィールの編集で、自動で投稿していることを書いておく（Bluesky には X のようなラベルの仕組みがないため）
4. `.env.local` に2行足して、サーバーを再起動する

```
BLUESKY_HANDLE=（ここにハンドル。例: hitoride.bsky.social）
BLUESKY_APP_PASSWORD=（ここにアプリパスワード）
```

# 自動投稿を始める

**設定 → 公開中の案件を、AIがSNSに自動で投稿する** をオンにすると、キーを入れた場所に、日本時間の8〜22時に、間隔をあけて投稿が始まります。内容は「集客」の作戦の「投稿の型」に沿います。投稿は案件の画面の「SNSで広める」に記録され、専用のリンクで、どの投稿から何人来たかが分かります。

## AIがしないこと
- 返信・引用・フォロー・いいね・DM など、他人への働きかけ（スパム扱いされやすく、X のルールでも制限があるため）
- 同じ文の繰り返し、架空の実績や誇大表現（下書きを書くときの決まりで止めています）
