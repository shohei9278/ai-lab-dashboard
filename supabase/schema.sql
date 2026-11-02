-- 公開用LPサイトのデータ。Supabase の SQL Editor に貼り付けて1回実行する。
-- どのテーブルも、ブラウザ（公開されているキー）からは直接読み書きできないようにし、
-- 公開用サイトのサーバーとダッシュボードだけが、秘密のキー（service role）で読み書きする。

-- 公開中のLP（ダッシュボードが書き込む）
create table if not exists lps (
  slug text primary key,            -- URLの一部（例: p23）
  project_id integer not null,      -- ダッシュボード側の案件番号
  version integer not null,         -- LPの版
  title text not null,
  content jsonb not null,           -- 見出し・悩み・特徴・ボタン文言・よくある質問
  status text not null default 'published' check (status in ('published', 'closed')),
  updated_at timestamptz not null default now()
);

-- 訪問（同じ人が同じ日に同じ版を何度見ても1回と数える）
create table if not exists lp_views (
  id bigserial primary key,
  slug text not null references lps(slug),
  version integer not null,
  visitor_id text not null,         -- ブラウザごとのランダムなID（個人を特定する情報ではない）
  day date not null default (now() at time zone 'Asia/Tokyo')::date,
  referrer text,
  created_at timestamptz not null default now(),
  unique (slug, version, visitor_id, day)
);

-- 事前登録（同じLPに同じメールは1回だけ）
create table if not exists signups (
  id bigserial primary key,
  slug text not null references lps(slug),
  version integer not null,
  email text not null,
  visitor_id text,
  day date not null default (now() at time zone 'Asia/Tokyo')::date,
  created_at timestamptz not null default now(),
  unique (slug, email)
);

create index if not exists lp_views_slug_day on lp_views (slug, day);
create index if not exists signups_slug_day on signups (slug, day);

-- 行レベルのセキュリティを有効にし、ポリシーは作らない
-- （＝公開キーでは一切読み書きできない。秘密のキーだけが使える）
alter table lps enable row level security;
alter table lp_views enable row level security;
alter table signups enable row level security;

-- ---- 追加（動くツールの案件用）。すでに上を実行済みなら、ここから下だけを実行すればよい ----
-- ツールを使った・シェアした（同じ人が同じ日に同じ版で何度やっても1回と数える）
create table if not exists tool_events (
  id bigserial primary key,
  slug text not null references lps(slug),
  version integer not null,
  visitor_id text not null,
  kind text not null check (kind in ('use', 'share')),
  day date not null default (now() at time zone 'Asia/Tokyo')::date,
  created_at timestamptz not null default now(),
  unique (slug, version, visitor_id, kind, day)
);
create index if not exists tool_events_slug_day on tool_events (slug, day);
alter table tool_events enable row level security;
