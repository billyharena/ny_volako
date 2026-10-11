-- Le navigateur lit ses lignes, mais écrit exclusivement via le protocole RPC.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'ny_volako_writer') then
    create role ny_volako_writer nologin noinherit nobypassrls;
  end if;
end $$;
grant ny_volako_writer to postgres;
create schema private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, ny_volako_writer;
grant usage on schema public to ny_volako_writer;

-- auth appartient à Supabase : postgres ne peut pas en déléguer USAGE.
-- Même lecture des claims vérifiés par PostgREST que auth.uid(), sans accès à auth.
-- Le client HTTP ne peut pas fixer ces paramètres PostgreSQL lui-même.
create function private.request_user_id() returns uuid
language sql stable set search_path = '' as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
$$;
revoke all on function private.request_user_id() from public, anon, authenticated;
grant execute on function private.request_user_id() to ny_volako_writer;

create function private.valid_thresholds(value integer[]) returns boolean
language sql immutable set search_path = '' as $$
  select cardinality(value) between 1 and 100
    and not exists (select 1 from unnest(value) n where n is null or n < 1 or n > 100)
    and cardinality(value) = (select count(distinct n) from unnest(value) n)
$$;

create table public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  currency text not null default 'MGA' check (currency ~ '^[A-Z]{3}$'),
  timezone text not null default 'Indian/Antananarivo' check (length(timezone) between 1 and 100),
  theme text not null default 'system' check (theme in ('system', 'light', 'dark')),
  locale text not null default 'fr' check (locale = 'fr'),
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.categories (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 80),
  icon text check (icon in ('shopping-basket', 'bus', 'house', 'heart-pulse', 'coffee', 'ellipsis')),
  is_active boolean not null default true,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, id)
);
create table public.expenses (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  expense_date date not null check (expense_date between date '1900-01-01' and date '9999-12-31'),
  motif text not null check (length(btrim(motif)) between 1 and 240),
  category_id uuid not null,
  unit_price numeric(14,2) not null check (unit_price >= 0 and unit_price < 1000000000000),
  quantity numeric(10,3) not null check (quantity > 0 and quantity < 10000000),
  extra_fee numeric(14,2) not null default 0 check (extra_fee >= 0 and extra_fee < 1000000000000),
  total numeric generated always as (round(unit_price * quantity + extra_fee, 2)) stored,
  deleted_at timestamptz,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (user_id, category_id) references public.categories(user_id, id)
);
create table public.monthly_budgets (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  month_start date not null check (month_start between date '1900-01-01' and date '9999-12-01' and extract(day from month_start) = 1),
  budget_limit numeric(14,2) not null check (budget_limit > 0 and budget_limit < 1000000000000),
  warning_thresholds integer[] not null default '{70,85,100}' check (private.valid_thresholds(warning_thresholds)),
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, month_start)
);
create table public.sync_receipts (
  user_id uuid not null references auth.users(id) on delete cascade,
  operation_id uuid not null,
  request jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, operation_id)
);
create index expenses_user_date on public.expenses(user_id, expense_date, id);
create index expenses_user_category on public.expenses(user_id, category_id);
create index categories_user_active on public.categories(user_id, is_active);

-- Noms statiques de la migration ; aucun identifiant provenant du client.
do $$ declare t text; begin
  foreach t in array array['user_settings','categories','expenses','monthly_budgets','sync_receipts'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant select, insert, update on public.%I to ny_volako_writer', t);
    execute format('create policy owner_read on public.%I for select to authenticated using ((select auth.uid()) = user_id)', t);
    execute format('create policy owner_write on public.%I to ny_volako_writer using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', t);
  end loop;
end $$;
revoke update on public.sync_receipts from ny_volako_writer;
revoke all on function private.valid_thresholds(integer[]) from public, anon;
grant execute on function private.valid_thresholds(integer[]) to authenticated, ny_volako_writer;
