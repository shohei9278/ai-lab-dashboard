# 外から入れたスキルの出どころ（2026-11-15 に取得し、中身を読んでから入れた）

- web-design-guidelines, vercel-react-best-practices: https://github.com/vercel-labs/agent-skills （1a2c79d）
  - web-design-guidelines の決まり（command.md）は、元は使うたびに外から読みに行く作りだったが、確かめていない指示を読まないように、https://github.com/vercel-labs/web-interface-guidelines （434b7f9）の command.md を読んでから取り込み、スキルからはその写しを読むように変えた
- web-quality-audit, seo, core-web-vitals, performance, accessibility, best-practices: https://github.com/addyosmani/web-quality-skills （afa8da9）
  - web-quality-audit/scripts/analyze.sh は HTML を読むだけのスクリプト（jq が要る）

取り込んだあと、PR のレビューの指摘で、元から直したところ:
- best-practices/SKILL.md: Permissions-Policy の例を、効かない `<meta>` から、レスポンスヘッダー（と Next.js の `headers()`）に直した
- accessibility/references/A11Y-PATTERNS.md: エラー処理の例で、例のHTMLにない `error-summary` を触っていた行を消した（最初の不正な欄に移るだけにした）

更新するときは、同じリポジトリから取り直し、差分を読んでから入れ替える（上の直しを消さないように）。
