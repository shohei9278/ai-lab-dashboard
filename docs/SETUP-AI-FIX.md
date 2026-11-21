# 提案箱の改善を、Claude Code に直してもらう（ルーティン）

提案箱の「仕組みの改善」にある「AIに直させる」を押すと、クラウドの Claude Code が直して PR を作り、チェックと ai-review まで進めます。運営者がするのは、PR を見てマージすることだけです。

- Claude Code のルーティン（claude.ai/code）で動きます。費用はサブスクの使用量からで、API の請求はありません
- 作業の様子は、提案箱の「作業の様子」から claude.ai/code で見られ、途中で口を出せます
- ルーティンは研究中の機能です。1つのルーティンは1時間に30回まで起動でき、ダッシュボードからは同じ提案を1時間に1回まで頼めます

## 1. ルーティンを作る（1回だけ）
1. https://claude.ai/code/routines を開き、新しいルーティンを作ります
2. リポジトリは `shohei9278/ai-lab-dashboard` を選びます
3. 指示（プロンプト）に、[routine-proposal-fix.md](routine-proposal-fix.md) の中身をそのまま貼ります
4. 環境は、`npm ci` ができるよう、パッケージを取りに行ける通信を許したものにします
5. 決まった時刻に動かす設定（スケジュール）は付けません

## 2. 起動用のトークンを作る
1. 作ったルーティンの「Edit」を開き、Trigger の行の「+」から「API」を選びます
2. 「Generate token」でトークンを作ります。トークンは一度しか出ないので、すぐ次の手順で使います
3. 同じ画面にある起動の URL（`https://api.anthropic.com/v1/claude_code/routines/trig_…/fire`）も控えます

## 3. Railway に入れる
ダッシュボードの Railway の Variables に、次の2つを入れます。ほかの場所（会話・コード・GitHub）には置きません。

| 名前 | 値 |
| --- | --- |
| `CLAUDE_ROUTINE_FIRE_URL` | 起動の URL |
| `CLAUDE_ROUTINE_TOKEN` | 作ったトークン |

入れると Railway が出し直し、提案箱の「仕組みの改善」に「AIに直させる」が出ます。

## 止めるとき・トークンが漏れたとき
- ルーティンの Trigger の画面で、トークンを消す（Delete token）か作り直します（Regenerate）
- Railway の変数を消すと、提案箱のボタンは出なくなります

## main を守る
ルーティンは `claude/proposal-<番号>` のブランチに push します。main へ直接入らないよう、GitHub の main の保護（PR を通さない push を止める）を付けておきます。

## いま作ってあるもの（2026-11-21）
- ルーティン「提案箱の改善を直して PR を作る」（`trig_01Y5SMtXXi53Bs3buR3EZ9PS`）。環境は Default（本番のダッシュボードには通信しない）
- ルーティン「案件のツールを作る」（`trig_01JJmfRhxAsH7WLUfhRRQkUP`）。環境は、ダッシュボードへの通信を許し、`LAB_DASHBOARD_URL`・`LAB_TOOL_TOKEN` を入れたもの。手順は [routine-tool-build.md](routine-tool-build.md)
- 作るときの API が「いつ動かすか」を必ず求めるので、2030年1月1日に1回、として作りました（ツールのほうは、運営者が編集したときに外れています）。どちらも、ダッシュボードから起動したときだけ動きます

## ツールを作るルーティンの変数（Railway）
| 名前 | 値 |
| --- | --- |
| `CLAUDE_TOOL_ROUTINE_FIRE_URL` | 「案件のツールを作る」の起動の URL |
| `CLAUDE_TOOL_ROUTINE_TOKEN` | 「案件のツールを作る」の API のトークン |
| `LAB_TOOL_TOKEN` | ルーティンがダッシュボードに入る合言葉（32文字以上。ルーティンの環境の変数と同じ値） |

自動で頼むか・同時に頼む数・1日に頼む数は、ダッシュボードの設定の「ツールを作るルーティン」で決めます。
