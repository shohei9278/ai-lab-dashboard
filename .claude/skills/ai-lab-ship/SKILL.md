---
name: ai-lab-ship
description: ai-lab の PR をマージして本番に出すまでの手順。運営者が「マージして」「確認してマージ」「本番に出して」と言ったとき、または ai-lab の PR のマージ後の確認をするときに使う。ダッシュボード（Railway）と公開サイト Hitoride（Vercel、手で出す）の両方を扱う。
---

# ai-lab をマージして本番に出す

決まりの元は `ai-lab/CLAUDE.md`。ここはその手順を順番に並べたもの。食い違ったら CLAUDE.md を優先する。

## 0. 範囲を確かめる
- マージしてよいのは、運営者が「マージして」と言ったときだけ。「確認して」「PRを作って」ではマージしない
- 通常のマージ（`gh pr merge <番号> --merge`）。スカッシュしない（人の手の記録がコミットIDにリンクしている）

## 1. マージの前に（すべて1回ずつ見る。繰り返し見に行かない）
1. `gh pr checks <番号>` で `check` と `ai-review` が pass か
   - まだ動いているなら、運営者に「チェックが終わったらもう一度言ってください」と伝えて止まる
2. ai-review のコメント（`gh pr view <番号> --json comments`）を読む
   - 指摘があれば、直すかどうかを判断する。直すなら push して、1 に戻る（push するとチェックはやり直し）
   - 方針が途中で変わったのに PR の説明文が古いままなら、説明文を直す（ai-review は説明文を要件として読む）
3. 本番が止まっているか: 次が `idle` と出ること（`activities` と `building` が、どちらも空の配列）
   ```bash
   curl -fsS --max-time 20 https://ai-lab-dashboard-production-fc9e.up.railway.app/api/live | jq -e '(.activities|type=="array" and length==0) and (.building|type=="array" and length==0)' >/dev/null && echo idle
   ```
   - 何か動いている（`idle` と出ず、エラーもない）なら、終わるまで待つよう運営者に伝える
   - 取れない・エラーになる（通信の失敗、500、ログインの画面、JSON でない など）ときは、止まっているかが分からないので、マージせずに止まって運営者に伝える
4. 人が見つけた不具合や人の判断の入った変更なら、`src/lib/interventions.ts` の `FIRST` に人の手の記録が入っているか
5. ページの URL を消した・移した・名前を変えた PR なら、`.github/workflows/smoke.yml` の一覧も同じ PR で直っているか
   - 直っていなければマージしない。同じ PR で直して push し、1 に戻る（マージしてからだと、本番の確認が失敗し続ける main になる）

## 2. マージ
```bash
gh pr merge <番号> --merge
git switch main && git pull
```

## 3. 本番に出す
- **ダッシュボード**: main に入ると Railway が自動で出す。始まらないときは Railway の「Deploy latest commit」を運営者に頼む
- **公開サイト（`lp-site/` を変えた PR のときだけ）**: main にマージしても出ない。手元のフォルダの中身がそのまま出るので、出す前に、手元が `origin/main` とまったく同じかを確かめる（コミットしていない変更・まだ入っていないファイル・手元だけのコミットがあると、レビューしていない内容を出してしまう）
  ```bash
  git fetch origin && test -z "$(git status --porcelain)" && test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" && echo clean
  ```
  - `clean` と出なければ出さない。何が違うかを運営者に伝えて止まる（勝手に消したり戻したりしない）
  - `clean` と出たら:
  ```bash
  cd lp-site && npx vercel deploy --prod --yes
  ```
  - 出たかは `npx vercel inspect <出たURL>` の status と、ブラウザで一度開いて確かめる
  - curl で短い間隔に何度も読みに行かない（Vercel の防御で 403 になる）

## 4. 出たあと
- 本番の確認（smoke.yml）が、出たあとと30分ごとに主要ページ・来訪者の 403・main の最新が出ているかを見る。結果を繰り返し見に行かない
- 変えた画面を一度だけ開いて、変更が出ているかを見る。まだなら「Railway が出している途中」と運営者に伝えて終える（何度も見に行かない）
- 運営者への報告: マージしたPR・マージ前に確かめたこと・本番に出たか（確かめていなければ、そう書く）
