---
name: ai-lab-screen-check
description: ai-lab のダッシュボードの画面の変更を、手元で試しのデータを入れて動かし、PC とスマホの幅で撮って確かめる手順。画面の見た目・文言・リンクを変えたあと、PR を作る前に使う。本番のデータやAIを呼ぶ操作は使わない。
---

# ai-lab の画面を手元で撮って確かめる

CLAUDE.md の「画面が変わるときは、PCとスマホの幅で画面を撮って確かめる」を、毎回同じやり方でするための手順。

## 決まり
- 本番のデータは使わない。作業用のフォルダ（scratchpad）に空の DB を作り、確かめたい状態だけ入れる
- `AI_LAB_SCHEDULER=off` を必ず付ける（自動実行を手元で動かさない）
- AIを呼ぶボタン（会議・アイデア出し・描き直しなど）は押さない。お金がかかる
- 終わったら、手元のサーバーを止め、試しの DB・種のスクリプト・ログを消す

## 1. 試しのデータを入れる
scratchpad に種のスクリプトを書き、`AI_LAB_DB` で DB の場所を指して `npx tsx` で動かす。import は ai-lab の `src/lib/db` を絶対パスで指す。

```ts
import { db } from "<ai-lab の絶対パス>/src/lib/db";
import { jstToday } from "<ai-lab の絶対パス>/src/lib/loop";
const add = (title: string, stage: string, kind = "lp") =>
  Number(db().prepare("INSERT INTO projects (title, target, problem, solution, hypothesis, ai_reason, stage, model_id, kind) VALUES (?, 't', 'p', 's', 'h', 'r', ?, 'claude', ?)").run(title, stage, kind).lastInsertRowid);
const a = add("ビンゴ景品わりふり電卓", "live", "tool");
// 集客お休み: stage を 'hold' にし、hold_reason と hold_until を入れる
// 今日の数字: metrics に (project_id, day = jstToday(), visits, signups, source = 'real') を入れる
```

```bash
AI_LAB_DB=<scratchpad>/check.db AI_LAB_SCHEDULER=off npx tsx <scratchpad>/seed.ts
```

## 2. 手元で動かす
`DASHBOARD_PASSWORD` が空なら、すべて運営者として開ける。`.env.local` やシェルに値が入っていると来訪者の画面になるので、起動のコマンドで必ず明示する（コマンドで付けた値は `.env.local` より優先される）。
- 運営者の画面: `DASHBOARD_PASSWORD=`（空）
- 来訪者の画面: `DASHBOARD_PASSWORD=<仮の値>` を付けて、ログインせずに開く

起動の前に、3472番が空いているかを見る。何か出たら、ほかのサーバーが使っているので、起動せずに止まって運営者に伝える（そのまま進むと、別のサーバーの画面を撮り、片付けで止めてしまう）。

```bash
lsof -nP -iTCP:3472 -sTCP:LISTEN
```

空いていたら、`&` でバックグラウンドにして起動し、PID をファイルに控える（コマンドを打つたびにシェルが変わるので、変数ではなくファイルに残す）。

```bash
DASHBOARD_PASSWORD= AI_LAB_DB=<scratchpad>/check.db AI_LAB_SCHEDULER=off npx next dev -p 3472 > <scratchpad>/next.log 2>&1 & echo $! > <scratchpad>/next.pid
```
起動を待つときは、数秒おきに次の2つを見る。両方そろうまで撮らない。
- 控えた PID がまだ動いている: `kill -0 "$(cat <scratchpad>/next.pid)"`（失敗したら起動に失敗しているので、`next.log` を読む）
- `next.log` に `Ready` が出て、`curl -s -o /dev/null -w "%{http_code}" localhost:3472/` が 200

## 3. 撮る
ブラウザの窓が小さいことがあるので、Playwright（`playwright-core`、ai-lab の node_modules にある）を headless で使う。ブラウザは `~/Library/Caches/ms-playwright/chromium_headless_shell-*/*/chrome-headless-shell` にあるものを `executablePath` で指す（`npx playwright install` はしない）。

- 幅は PC `1280` と スマホ `390`
- 変えた所までスクロールしてから撮る（`locator(...).scrollIntoViewIfNeeded()`）
- リンクを変えたなら、押して移った先の URL と画面も撮る
- 撮った画像は Read で開いて、崩れ・はみ出し・文言を自分の目で見る

## 4. 片付け
自分で起動したものだけを止める（`pkill -f` や、3472番を開いているプロセスをまとめて止めるやり方は、ほかのプロセスまで止めることがある）。`npx` の下で Next.js がさらにプロセスを起こすので、控えた PID と、その下のプロセスを止める。

```bash
pid=$(cat <scratchpad>/next.pid); kids=$(pgrep -P "$pid"); grand=$(for k in $kids; do pgrep -P "$k"; done); kill $grand $kids "$pid" 2>/dev/null || true
rm -f <scratchpad>/check.db <scratchpad>/check.db-wal <scratchpad>/check.db-shm <scratchpad>/seed.ts <scratchpad>/next.pid <scratchpad>/next.log
```
止まったかは `lsof -nP -iTCP:3472 -sTCP:LISTEN` が何も出さないことで確かめる。まだ残っていたら、出たプロセスが自分の起動したもの（`ps -o ppid=,command= -p <PID>` で `next dev -p 3472` と分かる）かを見てから止める。
`.claude/launch.json` に一時の起動設定を足したなら、それも消す。

## 報告
PR の説明文の「確かめたこと」に、どの画面を、どの幅で撮ったかを書く。撮っていない画面は「確かめていない」と書く。
