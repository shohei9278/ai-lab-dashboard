# AI Product Lab

Claude・GPT・Gemini の3社のAIを「社員」にして、小さなプロダクトを自動で作り、公開し、人を呼び、続けるか撤退するかまで決めさせる実験です。個人で設計・開発・運用しています。

- 実験の概要（見るだけのページ）: https://ai-lab-dashboard-production-fc9e.up.railway.app/showcase
- ダッシュボード（閲覧専用で公開）: https://ai-lab-dashboard-production-fc9e.up.railway.app
- AIが作ったツールと事前登録のページ: https://hitoride.vercel.app

## AIが回している流れ

1. **アイデア出し**: 3社のAIがアイデアを出し、作者を伏せて互いに採点する。点の高い案を案件にする
2. **作る**: 案件ごとに、事前登録のページ（LP）か、その場で使える動くツールを作る。ページのデザインは複数のAIが作り比べ、作者を伏せて選ぶ
3. **公開前チェック**: 誇大表現・架空の実績・ツールでできないことの記載などを、別の工程のAIが確かめる。通れば人の承認なしで公開する
4. **集客**: 毎朝、日替わりの担当のAIが全案件を振り返り、今のネックとその日の投稿（Threads・Bluesky・X）やページの直しを決めて実行する
5. **判断**: 訪問や日数が基準に達すると、AIが「続ける・改善・集客の見直し・撤退」を判断する
6. **教訓**: 終わった案件から教訓を残し、次のアイデア出しや計画で参照する

週1回の定例会議で3社が振り返り、仕組みの改善案を「提案箱」に入れる。運営者（人）は社長として、あとから確認したり、提案に返事をしたりする。

## 安全装置

- **予算と緊急停止**: AIを呼ぶたびに今月の費用を確かめ、上限に達したら呼び出しを止める（`src/lib/ai.ts`）。緊急停止ですべての呼び出しを止められる
- **公開前チェックと、その評価**: 人を通らずに公開するときの最後の砦なので、正解の決まった40件の例（問題を1つだけ入れたページと、問題のないページ）で、見逃しと止めすぎを測る（`src/lib/checkEval.ts`）
- **AIだけで公開できる件数の上限**: 超えた分は人の判断に回す。撤退も、訪問が基準に届かないうちは人の判断に回す
- **閲覧専用の公開**: ログインしていない人の GET 以外の呼び出しは入口（`src/proxy.ts`）ですべて 403 にする。個人の情報・他人の投稿・AIの入出力・下書きは伏せる
- **改善の記録**: 人が見つけた不具合や、人が決めた方針は、PRごとに記録してダッシュボードで公開している（`src/lib/interventions.ts`）。AIの社員が提案して人が答えた仕組みの改善も、提案箱から集めて並べている
- **じっくり案件**: ふつうのツールの制限（40,000文字・データは代表的なものだけ・フォントなし・1回で書き上げる）を外して作り込む枠。コードは60,000文字まで、Google Fonts が使え、通信は Google Fonts 以外止めたまま。大きなデータ（数百〜2,500件の一覧）が要るときだけ、AIがデータを下書きし、人が判断待ちで確かめ（公式の表などは人が CSV で入れられる）、枠の中に `window.labData` として置く。できたツールは、画面を撮って見た目を磨く段を1回通す（`src/lib/deep.ts`）

## 技術

| | |
|---|---|
| 画面 | Next.js 16（App Router）・React 19・TypeScript・Tailwind CSS |
| データ | SQLite（better-sqlite3） |
| AI | Anthropic・OpenAI・Google の各SDK |
| 公開サイト（`lp-site/`） | Next.js を Vercel に。登録とページ内の動きを Supabase に送り、ダッシュボードが5分ごとに取り込む |
| 自動化 | Playwright（公開前の画面撮影・ツールの自動テスト）、Threads・Bluesky・X の API |
| 運用 | Railway（Docker）・GitHub Actions |

## 開発のしかた

- コードは主に Claude Code で書き、人は問題の発見・方針の決定・動作の確認を受け持つ
- 変更はすべてPRで出し、CI（型チェック・lint・テスト・来訪者の画面のテスト・ビルド）と、別のAI（GPT）のレビューを通してからマージする
- 本番に出たあとは、主要ページ・閲覧専用の守り・最新のコミットが出ているかを、30分ごとに自動で確かめる（`.github/workflows/smoke.yml`）
- 作業の決まりは `CLAUDE.md`、本番に出す手順と画面を確かめる手順は `.claude/skills/` にある

## 主なファイル

| 場所 | 内容 |
|---|---|
| `src/lib/loop.ts` | 製品ループ（アイデア・作成・チェック・公開・判断・教訓） |
| `src/lib/plan.ts` | 毎朝の計画（朝会）と、その実行 |
| `src/lib/ai.ts` | 予算・緊急停止つきのAIの呼び出し |
| `src/lib/freePage.ts` | ページのデザイン（作り比べと採点） |
| `src/lib/checkEval.ts`・`checkEvalCases.ts` | 公開前チェックの評価 |
| `src/lib/sns.ts`・`snsApi.ts` | SNSへの投稿 |
| `src/lib/scheduler.ts` | 自動実行の予定 |
| `src/app/` | ダッシュボードの画面（ホームのオフィス・案件・AIの成績・概要ページなど） |
| `lp-site/` | 公開サイト |
| `tests/`・`e2e/` | テスト・来訪者の画面のテスト |

## 手元で動かす

```bash
npm install
cp .env.example .env.local   # 実際のAIを使うときだけキーを書く
AI_LAB_SCHEDULER=off npm run dev -- -p 3456
```

http://localhost:3456 を開く。`AI_LAB_SCHEDULER=off` を付けないと、自動実行が手元でも動く。

確かめる:

```bash
npm run typecheck
npm run lint
npm test
npm run test:e2e   # 来訪者の画面
```

公開サイトやSNS・通知の設定は `docs/` を参照。
