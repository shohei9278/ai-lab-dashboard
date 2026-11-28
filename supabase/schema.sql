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

-- ---- 追加（SNSの投稿ごとの計測用）。ここから下だけを実行すればよい ----
-- 投稿に付けた専用のリンク（?s=…）から来た訪問を見分ける
alter table lp_views add column if not exists source text;

-- ---- 追加（ページの中でどこまで進んだかの計測用）。ここから下だけを実行すればよい ----
-- GA に送っているのと同じイベント（ボタンを押した・入力を始めた・どこまで読んだ・登録した・使った・シェアした）を、
-- 訪問者ごと・1日1回だけ記録する。ダッシュボードの「ページの中での動き」に使う
create table if not exists lp_events (
  id bigserial primary key,
  slug text not null references lps(slug),
  version integer not null,
  visitor_id text not null,
  name text not null check (name in ('cta_click', 'form_start', 'section_view', 'scroll_depth', 'sign_up', 'sign_up_error', 'tool_use', 'share')),
  detail text not null default '', -- section_view は部分の名前、scroll_depth は % 、share は方法
  day date not null default (now() at time zone 'Asia/Tokyo')::date,
  created_at timestamptz not null default now(),
  unique (slug, version, visitor_id, name, detail, day)
);
create index if not exists lp_events_slug on lp_events (slug, version);
alter table lp_events enable row level security;

-- ---- 追加（利用者の声）。ここから下だけを実行すればよい ----
-- LP・ツールの右下の「ひとこと聞かせてください」から届く、匿名の声（名前・メールは聞かない）
-- 訪問者ごとに、同じページの同じ版へは1回だけ
create table if not exists feedback (
  id bigserial primary key,
  slug text not null references lps(slug),
  version integer not null,
  visitor_id text not null,
  kind text not null check (kind in ('lp', 'tool')),
  choice text not null check (choice in ('useful', 'confusing', 'not_what_i_want', 'not_now', 'unclear', 'distrust', 'other')),
  text text not null default '' check (char_length(text) <= 300),
  created_at timestamptz not null default now(),
  unique (slug, version, visitor_id)
);
create index if not exists feedback_slug on feedback (slug);
alter table feedback enable row level security;

-- ---- 追加（SNS のアプリの中のブラウザの計測用）。ここから下だけを実行すればよい ----
-- どのアプリの中のブラウザで開いたか（x / instagram / line / other。アプリの外は ""、この列を足す前の訪問は空）
alter table lp_views add column if not exists inapp text;

-- ---- 追加（その場で AI を呼ぶツール）。ここから下だけを実行すればよい ----
-- 公開サイトのサーバー（/api/tool-ai）が、AI を呼ぶ前に1回分の最大の額を先に取っておき、終わったら実際の額で精算する
-- 取るのと残りを確かめるのは reserve_tool_ai の1回の操作で行う（同時に呼ばれても上限を超えないよう、1つの鍵で順番にする）
-- お金がかかったか分からない呼び出しは、取っておいた額のまま残す（spent_jpy が null なら reserved_jpy で数える）
-- 上限（1日100円・月3,100円・1ブラウザ1日10回）は、11/28 に運営者が決めた。止めるスイッチと、ダッシュボードの月の予算が残っているかは、ダッシュボードが tool_ai_settings に書く
create table if not exists tool_ai_settings (
  id integer primary key check (id = 1),
  enabled boolean not null default false,       -- ダッシュボードの止めるスイッチが切れているとき true
  budget_ok boolean not null default false,     -- ダッシュボードの今月のAI予算が残っているとき true
  day_cap_jpy numeric not null default 100,
  month_cap_jpy numeric not null default 3100,
  visitor_day_max integer not null default 10,
  updated_at timestamptz not null default now()
);
insert into tool_ai_settings (id) values (1) on conflict (id) do nothing;
alter table tool_ai_settings enable row level security;

create table if not exists tool_ai_uses (
  id bigserial primary key,
  slug text not null references lps(slug),
  version integer not null,
  visitor_id text not null,
  day date not null default (now() at time zone 'Asia/Tokyo')::date,
  reserved_jpy numeric not null check (reserved_jpy > 0),
  spent_jpy numeric check (spent_jpy >= 0),
  created_at timestamptz not null default now(),
  settled_at timestamptz
);
create index if not exists tool_ai_uses_day on tool_ai_uses (day);
create index if not exists tool_ai_uses_visitor_day on tool_ai_uses (visitor_id, day);
alter table tool_ai_uses enable row level security;

-- 先に取っておく。取れたら番号、止まっている・上限を超える・回数を使い切ったときは null
create or replace function reserve_tool_ai(p_slug text, p_version integer, p_visitor text, p_amount numeric) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  s tool_ai_settings;
  d date := (now() at time zone 'Asia/Tokyo')::date;
  used_day numeric;
  used_month numeric;
  n integer;
  rid bigint;
begin
  if p_amount is null or p_amount <= 0 then return null; end if;
  perform pg_advisory_xact_lock(hashtext('tool_ai_budget'));
  select * into s from tool_ai_settings where id = 1;
  if not found or not s.enabled or not s.budget_ok then return null; end if;
  select coalesce(sum(coalesce(spent_jpy, reserved_jpy)), 0) into used_day from tool_ai_uses where day = d;
  select coalesce(sum(coalesce(spent_jpy, reserved_jpy)), 0) into used_month from tool_ai_uses where day >= date_trunc('month', d)::date;
  select count(*) into n from tool_ai_uses where day = d and visitor_id = p_visitor;
  if used_day + p_amount > s.day_cap_jpy or used_month + p_amount > s.month_cap_jpy or n >= s.visitor_day_max then return null; end if;
  insert into tool_ai_uses (slug, version, visitor_id, day, reserved_jpy) values (p_slug, p_version, p_visitor, d, p_amount) returning id into rid;
  return rid;
end $$;

-- 精算する。p_spent が null なら、お金がかかったか分からないので、取っておいた額のまま残す。1回だけ（2回目は変えない）
create or replace function settle_tool_ai(p_id bigint, p_spent numeric) returns void
language plpgsql security definer set search_path = public as $$
begin
  update tool_ai_uses set spent_jpy = case when p_spent is null then null else greatest(p_spent, 0) end, settled_at = now()
  where id = p_id and settled_at is null;
end $$;

-- 呼べるのは、公開サイトとダッシュボードのサーバー（service_role）だけ
revoke all on function reserve_tool_ai(text, integer, text, numeric) from public, anon, authenticated;
revoke all on function settle_tool_ai(bigint, numeric) from public, anon, authenticated;
grant execute on function reserve_tool_ai(text, integer, text, numeric) to service_role;
grant execute on function settle_tool_ai(bigint, numeric) to service_role;

-- 今月（日本時間）に使った額（円）。ダッシュボードが月の予算に数えるために読む
create or replace function tool_ai_month_spent() returns numeric
language sql security definer set search_path = public as $$
  select coalesce(sum(coalesce(spent_jpy, reserved_jpy)), 0) from tool_ai_uses
  where day >= date_trunc('month', (now() at time zone 'Asia/Tokyo')::date)::date
$$;
revoke all on function tool_ai_month_spent() from public, anon, authenticated;
grant execute on function tool_ai_month_spent() to service_role;
