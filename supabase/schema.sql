-- Safety Union Backup: Supabase schema (all tables prefixed sub_)
-- Run once in the Supabase SQL editor. All money moves through the functions below,
-- which only the service_role (your Worker) can execute. Browsers never touch the DB.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- config
create table public.sub_plan_limits (
  plan            text primary key check (plan in ('free','plus','platinum')),
  daily_out       bigint not null,      -- minor units (cents/kobo)
  fee_discount_bps int   not null,      -- 5000 = 50% off fees
  price           bigint not null       -- minor units per 30 days
);
insert into public.sub_plan_limits values
  ('free',     50000000,    0,      0),   -- NGN 500,000 per day
  ('plus',     200000000, 5000, 300000),   -- NGN 2,000,000 per day, NGN 3,000 per 30 days
  ('platinum', 500000000, 5000, 700000);  -- NGN 5,000,000 per day, NGN 7,000 per 30 days

create table public.sub_fee_config (
  id               boolean primary key default true check (id),
  receive_bps      int    not null default 150,   -- 1.5%
  withdraw_bps     int    not null default 100,   -- 1%
  withdraw_fixed   bigint not null default 5000,  -- NGN 50 in kobo
  min_withdraw     bigint not null default 100000, -- NGN 1,000
  currency         text   not null default 'NGN'  -- must match your Paystack account
);
insert into public.sub_fee_config default values;

-- ---------------------------------------------------------------- users
create table public.sub_profiles (
  id            uuid primary key references auth.users(id) on delete restrict,
  full_name     text not null default '',
  email         text not null,
  sub_tag       text not null unique,
  plan          text not null default 'free' references public.sub_plan_limits(plan),
  plan_expires_at timestamptz,
  card_frozen   boolean not null default false,
  account_frozen boolean not null default false,   -- set by admin only
  is_admin      boolean not null default false,
  created_at    timestamptz not null default now()
);
create unique index sub_profiles_email_idx on public.sub_profiles (lower(email));

create table public.sub_wallets (
  user_id  uuid primary key references public.sub_profiles(id) on delete restrict,
  balance  bigint not null default 0 check (balance >= 0),
  currency text not null default 'NGN'
);

-- Append-only ledger. Invariant: sub_wallets.balance = sum(delta) per user.
create table public.sub_ledger_entries (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references public.sub_profiles(id),
  kind          text not null check (kind in
                ('receive','sub_out','sub_in','withdraw','withdraw_refund')),
  gross         bigint not null,
  fee           bigint not null default 0,
  delta         bigint not null,
  balance_after bigint not null check (balance_after >= 0),
  ref           text,
  description   text not null default '',
  status        text not null default 'settled',
  idem_key      text,
  created_at    timestamptz not null default now()
);
create unique index sub_ledger_idem_idx on public.sub_ledger_entries (user_id, idem_key) where idem_key is not null;
create index sub_ledger_user_idx on public.sub_ledger_entries (user_id, id desc);

create or replace function public.block_mutation() returns trigger
language plpgsql as $$ begin raise exception 'append-only table'; end $$;
create trigger ledger_no_update before update or delete on public.sub_ledger_entries
  for each row execute function public.block_mutation();

create table public.sub_audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid, action text not null, target text, ip text, ua text, meta jsonb
);
create trigger audit_no_update before update or delete on public.sub_audit_log
  for each row execute function public.block_mutation();

-- ---------------------------------------------------------------- sub_payments
create table public.sub_payment_requests (
  id          uuid primary key default gen_random_uuid(),
  ref         text not null unique,
  owner_id    uuid not null references public.sub_profiles(id),
  amount      bigint not null check (amount > 0),
  currency    text not null,
  reason      text not null check (char_length(reason) between 1 and 140),
  payer_hint  text check (char_length(payer_hint) <= 120),
  status      text not null default 'open' check (status in ('open','paid','expired','cancelled')),
  expires_at  timestamptz not null default now() + interval '72 hours',
  created_at  timestamptz not null default now(),
  paid_at     timestamptz
);
create index sub_payreq_owner_idx on public.sub_payment_requests (owner_id, created_at desc);

-- One row per Paystack checkout attempt (requests and plan purchases).
create table public.sub_payments (
  reference   text primary key,
  purpose     text not null check (purpose in ('request','plan')),
  request_id  uuid references public.sub_payment_requests(id),
  user_id     uuid references public.sub_profiles(id),      -- plan buyer
  plan        text references public.sub_plan_limits(plan),
  amount      bigint not null check (amount > 0),
  currency    text not null,
  payer_email text not null,
  payer_name  text,
  status      text not null default 'initialized'
              check (status in ('initialized','success','needs_review')),
  created_at  timestamptz not null default now(),
  completed_at timestamptz
);

create table public.sub_webhook_events (
  event_key  text primary key,        -- "<event>:<reference>"
  received_at timestamptz not null default now(),
  payload_sha256 text not null
);

-- ---------------------------------------------------------------- payouts
create table public.sub_payout_accounts (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.sub_profiles(id),
  bank_code      text not null,
  bank_name      text not null,
  account_last4  text not null,
  account_name   text not null,
  recipient_code text not null,       -- Paystack recipient; full number is never stored here
  is_default     boolean not null default false,
  usable_after   timestamptz not null,
  created_at     timestamptz not null default now(),
  deleted_at     timestamptz
);
create index payout_user_idx on public.sub_payout_accounts (user_id) where deleted_at is null;

create table public.sub_withdrawals (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.sub_profiles(id),
  payout_id   uuid not null references public.sub_payout_accounts(id),
  amount      bigint not null check (amount > 0),
  fee         bigint not null check (fee >= 0),
  currency    text not null,
  status      text not null default 'pending_review' check (status in
              ('pending_review','processing','paid','rejected','failed','reversed')),
  approved_by uuid references public.sub_profiles(id),
  note        text,
  idem_key    text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index wd_idem_idx on public.sub_withdrawals (user_id, idem_key) where idem_key is not null;

create table public.sub_rate_limits (
  key text not null, window_start timestamptz not null, hits int not null default 0,
  primary key (key, window_start)
);

-- ---------------------------------------------------------------- new user trigger
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare tag text;
begin
  loop
    tag := lower(encode(gen_random_bytes(4), 'hex'));
    exit when not exists (select 1 from public.sub_profiles where sub_tag = tag);
  end loop;
  insert into public.sub_profiles (id, full_name, email, sub_tag)
  values (new.id, left(coalesce(new.raw_user_meta_data->>'full_name',''), 80), new.email, tag);
  insert into public.sub_wallets (user_id, currency) select new.id, currency from public.sub_fee_config;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- helpers
create or replace function public.effective_plan(p public.sub_profiles) returns text
language sql stable as $$
  select case when p.plan <> 'free' and (p.plan_expires_at is null or p.plan_expires_at > now())
              then p.plan else 'free' end $$;

create or replace function public.calc_fee(p_amount bigint, p_bps int, p_fixed bigint, p_disc int)
returns bigint language sql immutable as $$
  select floor(
    ((p_amount::numeric * p_bps + p_fixed::numeric * 10000) * (10000 - p_disc) / 100000000) + 0.5
  )::bigint $$;

create or replace function public.rl_hit(p_key text, p_window_s int, p_max int) returns boolean
language plpgsql security definer set search_path = public as $$
declare w timestamptz; n int;
begin
  w := to_timestamp(floor(extract(epoch from now()) / p_window_s) * p_window_s);
  insert into sub_rate_limits(key, window_start, hits) values (p_key, w, 1)
  on conflict (key, window_start) do update set hits = sub_rate_limits.hits + 1
  returning hits into n;
  if random() < 0.01 then delete from sub_rate_limits where window_start < now() - interval '1 day'; end if;
  return n <= p_max;
end $$;

-- ---------------------------------------------------------------- money functions
create or replace function public.create_payment_request(
  p_owner uuid, p_amount bigint, p_reason text, p_hint text, p_ref text)
returns public.sub_payment_requests language plpgsql security definer set search_path = public as $$
declare cur text; r public.sub_payment_requests; prof public.sub_profiles;
begin
  select * into prof from sub_profiles where id = p_owner;
  if prof.account_frozen then raise exception 'account_frozen'; end if;
  select currency into cur from sub_fee_config;
  if p_amount < 10000 then raise exception 'amount_too_small'; end if;
  insert into sub_payment_requests(ref, owner_id, amount, currency, reason, payer_hint)
  values (p_ref, p_owner, p_amount, cur, left(p_reason,140), left(p_hint,120)) returning * into r;
  return r;
end $$;

-- Called only after the webhook is verified AND Paystack verify API confirmed the charge.
create or replace function public.settle_payment(p_reference text, p_paid bigint, p_currency text)
returns text language plpgsql security definer set search_path = public as $$
declare pay sub_payments; req sub_payment_requests; fc sub_fee_config; own sub_profiles;
        disc int; fee bigint; bal bigint; cfg sub_plan_limits;
begin
  select * into pay from sub_payments where reference = p_reference for update;
  if not found then return 'unknown_reference'; end if;
  if pay.status = 'success' then return 'already_settled'; end if;
  if p_paid <> pay.amount or p_currency <> pay.currency then
    update sub_payments set status = 'needs_review' where reference = p_reference;
    return 'amount_mismatch';
  end if;

  if pay.purpose = 'plan' then
    select * into cfg from sub_plan_limits where plan = pay.plan;
    update sub_profiles set plan = pay.plan,
      plan_expires_at = greatest(coalesce(plan_expires_at, now()), now()) + interval '30 days'
    where id = pay.user_id;
    update sub_payments set status = 'success', completed_at = now() where reference = p_reference;
    return 'plan_activated';
  end if;

  select * into req from sub_payment_requests where id = pay.request_id for update;
  if req.status = 'cancelled' or req.status = 'paid' then
    update sub_payments set status = 'needs_review' where reference = p_reference;  -- refund manually
    return 'needs_review';
  end if;

  select * into fc from sub_fee_config;
  select * into own from sub_profiles where id = req.owner_id;
  select fee_discount_bps into disc from sub_plan_limits where plan = effective_plan(own);
  fee := calc_fee(req.amount, fc.receive_bps, 0, disc);

  update sub_wallets set balance = balance + (req.amount - fee) where user_id = req.owner_id
    returning balance into bal;
  insert into sub_ledger_entries(user_id, kind, gross, fee, delta, balance_after, ref, description)
  values (req.owner_id, 'receive', req.amount, fee, req.amount - fee, bal, req.ref, req.reason);

  update sub_payment_requests set status = 'paid', paid_at = now() where id = req.id;
  update sub_payments set status = 'success', completed_at = now() where reference = p_reference;
  return 'settled';
end $$;

create or replace function public.transfer_sub(
  p_sender uuid, p_recipient uuid, p_amount bigint, p_note text, p_idem text)
returns public.sub_ledger_entries language plpgsql security definer set search_path = public as $$
declare a uuid; b uuid; s sub_profiles; r sub_profiles; sb bigint; rb bigint; limit_out bigint;
        used bigint; entry sub_ledger_entries;
begin
  if p_sender = p_recipient then raise exception 'self_transfer'; end if;
  if p_amount < 10000 then raise exception 'amount_too_small'; end if;

  select * into entry from sub_ledger_entries where user_id = p_sender and idem_key = p_idem;
  if found then return entry; end if;                        -- idempotent replay

  -- lock sub_wallets in a stable order to avoid deadlocks
  a := least(p_sender, p_recipient); b := greatest(p_sender, p_recipient);
  perform 1 from sub_wallets where user_id = a for update;
  perform 1 from sub_wallets where user_id = b for update;

  select * into s from sub_profiles where id = p_sender;
  select * into r from sub_profiles where id = p_recipient;
  if s.account_frozen or r.account_frozen then raise exception 'account_frozen'; end if;

  select daily_out into limit_out from sub_plan_limits where plan = effective_plan(s);
  select coalesce(sum(-delta),0) into used from sub_ledger_entries
   where user_id = p_sender and kind in ('sub_out','withdraw') and created_at > now() - interval '24 hours';
  if used + p_amount > limit_out then raise exception 'daily_limit'; end if;

  update sub_wallets set balance = balance - p_amount where user_id = p_sender and balance >= p_amount
    returning balance into sb;
  if sb is null then raise exception 'insufficient_funds'; end if;
  update sub_wallets set balance = balance + p_amount where user_id = p_recipient returning balance into rb;

  insert into sub_ledger_entries(user_id, kind, gross, fee, delta, balance_after, ref, description, idem_key)
  values (p_sender, 'sub_out', p_amount, 0, -p_amount, sb, 'sub:' || r.sub_tag,
          'To @' || r.sub_tag || ' ' || left(coalesce(p_note,''),80), p_idem)
  returning * into entry;
  insert into sub_ledger_entries(user_id, kind, gross, fee, delta, balance_after, ref, description)
  values (p_recipient, 'sub_in', p_amount, 0, p_amount, rb, 'sub:' || s.sub_tag,
          'From @' || s.sub_tag || ' ' || left(coalesce(p_note,''),80));
  return entry;
end $$;

create or replace function public.request_withdrawal(
  p_user uuid, p_amount bigint, p_payout uuid, p_idem text, p_cooldown_ok boolean default true)
returns public.sub_withdrawals language plpgsql security definer set search_path = public as $$
declare prof sub_profiles; fc sub_fee_config; disc int; fee bigint; bal bigint; w sub_withdrawals;
        acct sub_payout_accounts; limit_out bigint; used bigint;
begin
  select * into w from sub_withdrawals where user_id = p_user and idem_key = p_idem;
  if found then return w; end if;

  perform 1 from sub_wallets where user_id = p_user for update;
  select * into prof from sub_profiles where id = p_user;
  if prof.account_frozen then raise exception 'account_frozen'; end if;
  select * into acct from sub_payout_accounts where id = p_payout and user_id = p_user and deleted_at is null;
  if not found then raise exception 'payout_not_found'; end if;
  if acct.usable_after > now() then raise exception 'payout_cooldown'; end if;

  select * into fc from sub_fee_config;
  if p_amount < fc.min_withdraw then raise exception 'amount_too_small'; end if;
  select fee_discount_bps, daily_out into disc, limit_out from sub_plan_limits where plan = effective_plan(prof);
  fee := calc_fee(p_amount, fc.withdraw_bps, fc.withdraw_fixed, disc);
  if fee >= p_amount then raise exception 'amount_too_small'; end if;

  select coalesce(sum(-delta),0) into used from sub_ledger_entries
   where user_id = p_user and kind in ('sub_out','withdraw') and created_at > now() - interval '24 hours';
  if used + p_amount > limit_out then raise exception 'daily_limit'; end if;

  update sub_wallets set balance = balance - p_amount where user_id = p_user and balance >= p_amount
    returning balance into bal;
  if bal is null then raise exception 'insufficient_funds'; end if;

  insert into sub_withdrawals(user_id, payout_id, amount, fee, currency, idem_key)
  values (p_user, p_payout, p_amount, fee, fc.currency, p_idem) returning * into w;
  insert into sub_ledger_entries(user_id, kind, gross, fee, delta, balance_after, ref, description, status, idem_key)
  values (p_user, 'withdraw', p_amount, fee, -p_amount, bal, 'wd:' || w.id,
          'Withdrawal to ' || acct.bank_name || ' ****' || acct.account_last4, 'pending', 'wd:' || w.id);
  return w;
end $$;

-- Admin moves pending_review -> processing. Owner cannot approve their own withdrawal.
create or replace function public.admin_claim_withdrawal(p_id uuid, p_admin uuid)
returns public.sub_withdrawals language plpgsql security definer set search_path = public as $$
declare w sub_withdrawals;
begin
  select * into w from sub_withdrawals where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  if w.status <> 'pending_review' then raise exception 'bad_state'; end if;
  if w.user_id = p_admin then raise exception 'self_approval'; end if;
  update sub_withdrawals set status = 'processing', approved_by = p_admin, updated_at = now()
   where id = p_id returning * into w;
  return w;
end $$;

-- Put a claimed withdrawal back in the queue (Paystack balance too low, transfer never created).
create or replace function public.admin_release_withdrawal(p_id uuid) returns text
language plpgsql security definer set search_path = public as $$
begin
  update sub_withdrawals set status = 'pending_review', approved_by = null, updated_at = now()
   where id = p_id and status = 'processing';
  return case when found then 'released' else 'no_change' end;
end $$;

-- Single place that refunds. Guarded by status so a refund can happen only once.
create or replace function public.fail_withdrawal(p_id uuid, p_new_status text, p_note text)
returns text language plpgsql security definer set search_path = public as $$
declare w sub_withdrawals; bal bigint;
begin
  if p_new_status not in ('rejected','failed','reversed') then raise exception 'bad_status'; end if;
  select * into w from sub_withdrawals where id = p_id for update;
  if not found then return 'not_found'; end if;
  if not (w.status in ('pending_review','processing') or (w.status = 'paid' and p_new_status = 'reversed')) then
    return 'no_change';
  end if;
  update sub_wallets set balance = balance + w.amount where user_id = w.user_id returning balance into bal;
  insert into sub_ledger_entries(user_id, kind, gross, fee, delta, balance_after, ref, description, idem_key)
  values (w.user_id, 'withdraw_refund', w.amount, -w.fee, w.amount, bal, 'wd:' || w.id,
          'Withdrawal ' || p_new_status, 'wdr:' || w.id);
  update sub_withdrawals set status = p_new_status, note = p_note, updated_at = now() where id = p_id;
  return 'refunded';
end $$;

create or replace function public.mark_withdrawal_paid(p_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare w sub_withdrawals;
begin
  select * into w from sub_withdrawals where id = p_id for update;
  if not found then return 'not_found'; end if;
  if w.status <> 'processing' then return 'no_change'; end if;
  update sub_withdrawals set status = 'paid', updated_at = now() where id = p_id;
  return 'paid';
end $$;

-- Run this on a schedule. Any row returned means money does not add up.
create or replace view public.integrity_check as
  select w.user_id, w.balance, coalesce(sum(l.delta),0) as ledger_sum
  from sub_wallets w left join sub_ledger_entries l on l.user_id = w.user_id
  group by w.user_id, w.balance
  having w.balance <> coalesce(sum(l.delta),0);

-- ---------------------------------------------------------------- lock everything down
alter table public.sub_plan_limits      enable row level security;
alter table public.sub_fee_config       enable row level security;
alter table public.sub_profiles         enable row level security;
alter table public.sub_wallets          enable row level security;
alter table public.sub_ledger_entries   enable row level security;
alter table public.sub_audit_log        enable row level security;
alter table public.sub_payment_requests enable row level security;
alter table public.sub_payments         enable row level security;
alter table public.sub_webhook_events   enable row level security;
alter table public.sub_payout_accounts  enable row level security;
alter table public.sub_withdrawals      enable row level security;
alter table public.sub_rate_limits      enable row level security;
-- No policies on purpose: deny by default. The Worker uses service_role, which bypasses RLS.

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on functions from public, anon, authenticated;

grant execute on all functions in schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
