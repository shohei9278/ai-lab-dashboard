# ダッシュボードをサーバー（Railway）で動かすためのイメージ
# Chromium も入れるので、ツールの自動テスト・ページの画面の確認・デザインの参考の取り込みもサーバーで動く
# Node は 22（better-sqlite3 が対応している版）
FROM node:22-bookworm-slim

# 画面を撮るときに日本語と絵文字が正しく出るように、フォントを入れる。better-sqlite3 をビルドし直すときの道具も入れておく
RUN apt-get update \
  && apt-get install -y --no-install-recommends fonts-noto-cjk fonts-noto-color-emoji python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV TZ=Asia/Tokyo NEXT_TELEMETRY_DISABLED=1 PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

COPY package.json package-lock.json ./
RUN npm ci
# playwright-core と同じ版の Chromium と、動かすのに必要なものを入れる
RUN npx playwright-core install --with-deps chromium

COPY . .
RUN npm run build

# データ（DB・画面の写真など）は、Railway のボリューム（/data）に置く
ENV NODE_ENV=production AI_LAB_DB=/data/ai-lab.db
EXPOSE 3000
CMD ["sh", "-c", "npx next start -p ${PORT:-3000}"]
