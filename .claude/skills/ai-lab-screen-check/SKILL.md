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
`DASHBOARD_PASSWORD` を付けなければ、すべて運営者として開ける。来訪者の見え方を確かめたいときだけ、仮の値を付けてログインせずに開く。

```bash
AI_LAB_DB=<scratchpad>/check.db AI_LAB_SCHEDULER=off npx next dev -p 3472   # バックグラウンドで
```
起動を待つときは、`curl -s -o /dev/null -w "%{http_code}" localhost:3472/` が 200 になるまで数秒おきに見る。

## 3. 撮る
ブラウザの窓が小さいことがあるので、Playwright（`playwright-core`、ai-lab の node_modules にある）を headless で使う。ブラウザは `~/Library/Caches/ms-playwright/chromium_headless_shell-*/*/chrome-headless-shell` にあるものを `executablePath` で指す（`npx playwright install` はしない）。

- 幅は PC `1280` と スマホ `390`
- 変えた所までスクロールしてから撮る（`locator(...).scrollIntoViewIfNeeded()`）
- リンクを変えたなら、押して移った先の URL と画面も撮る
- 撮った画像は Read で開いて、崩れ・はみ出し・文言を自分の目で見る

## 4. 片付け
```bash
pkill -f "next dev -p 3472"
rm -f <scratchpad>/check.db <scratchpad>/check.db-wal <scratchpad>/check.db-shm <scratchpad>/seed.ts
```
`.claude/launch.json` に一時の起動設定を足したなら、それも消す。

## 報告
PR の説明文の「確かめたこと」に、どの画面を、どの幅で撮ったかを書く。撮っていない画面は「確かめていない」と書く。
