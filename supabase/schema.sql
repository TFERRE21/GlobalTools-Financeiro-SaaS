-- GlobalTools Financeiro — initial Supabase/PostgreSQL schema.
-- Apply in a NEW Supabase project after reviewing. Never disable RLS in production.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  legal_name text,
  display_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.company_members (
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner','admin','member','viewer')),
  created_at timestamptz not null default now(),
  primary key (company_id, user_id)
);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  created_by uuid not null references auth.users(id),
  description text not null check (char_length(description) between 1 and 200),
  category text,
  transaction_type text not null check (transaction_type in ('income','expense')),
  amount_cents bigint not null check (amount_cents > 0),
  transaction_date date not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists transactions_company_date_idx on public.transactions(company_id, transaction_date desc);

-- A single row per Stripe subscription; only the trusted server/webhook should write it.
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  company_id uuid references public.companies(id) on delete set null,
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  stripe_price_id text,
  status text not null default 'incomplete' check (status in ('incomplete','trialing','active','past_due','canceled','unpaid','paused','incomplete_expired')),
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  last_stripe_event_created_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Store event IDs to make webhook processing idempotent.
create table if not exists public.stripe_webhook_events (
  event_id text primary key,
  event_type text not null,
  processed_at timestamptz not null default now()
);

-- SECURITY DEFINER helpers avoid recursive RLS between companies and company_members.
create or replace function public.is_company_member(p_company_id uuid)
returns boolean language sql stable security definer set search_path = public
as $function$
  select exists (
    select 1 from public.company_members m
    where m.company_id = p_company_id and m.user_id = auth.uid()
  );
$function$;

create or replace function public.is_company_owner(p_company_id uuid)
returns boolean language sql stable security definer set search_path = public
as $function$
  select exists (
    select 1 from public.companies c
    where c.id = p_company_id and c.owner_id = auth.uid()
  );
$function$;

create or replace function public.can_edit_company(p_company_id uuid)
returns boolean language sql stable security definer set search_path = public
as $function$
  select public.is_company_owner(p_company_id) or exists (
    select 1 from public.company_members m
    where m.company_id = p_company_id and m.user_id = auth.uid()
      and m.role in ('owner','admin','member')
  );
$function$;

revoke all on function public.is_company_member(uuid) from public;
revoke all on function public.is_company_owner(uuid) from public;
revoke all on function public.can_edit_company(uuid) from public;
grant execute on function public.is_company_member(uuid) to authenticated;
grant execute on function public.is_company_owner(uuid) to authenticated;
grant execute on function public.can_edit_company(uuid) to authenticated;

alter table public.profiles enable row level security;
alter table public.companies enable row level security;
alter table public.company_members enable row level security;
alter table public.transactions enable row level security;
alter table public.subscriptions enable row level security;
alter table public.stripe_webhook_events enable row level security;

create policy "profile owner reads own profile" on public.profiles
  for select to authenticated using (id = auth.uid());
create policy "profile owner inserts own profile" on public.profiles
  for insert to authenticated with check (id = auth.uid());
create policy "profile owner updates own profile" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy "company members can read company" on public.companies
  for select to authenticated using (owner_id = auth.uid() or public.is_company_member(id));
create policy "authenticated users create own company" on public.companies
  for insert to authenticated with check (owner_id = auth.uid());
create policy "owner updates company" on public.companies
  for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "owner deletes company" on public.companies
  for delete to authenticated using (owner_id = auth.uid());

create policy "members read membership in their companies" on public.company_members
  for select to authenticated using (user_id = auth.uid() or public.is_company_owner(company_id));
-- Membership writes intentionally server-managed until invitation/role escalation rules are implemented.

create policy "company members read transactions" on public.transactions
  for select to authenticated using (public.is_company_member(company_id) or public.is_company_owner(company_id));
create policy "company members create transactions" on public.transactions
  for insert to authenticated with check (
    created_by = auth.uid() and public.can_edit_company(company_id)
  );
create policy "company members update transactions" on public.transactions
  for update to authenticated using (
    public.can_edit_company(company_id)
  ) with check (
    public.can_edit_company(company_id)
  );
create policy "company admins delete transactions" on public.transactions
  for delete to authenticated using (public.is_company_owner(company_id) or exists (
    select 1 from public.company_members m
    where m.company_id = transactions.company_id and m.user_id = auth.uid() and m.role in ('owner','admin')
  ));

create policy "users read own subscription" on public.subscriptions
  for select to authenticated using (user_id = auth.uid());
-- No client-side insert/update/delete policies for subscriptions or webhook events.
-- Trusted server must validate Stripe webhook signatures and map checkout sessions to authenticated users.
