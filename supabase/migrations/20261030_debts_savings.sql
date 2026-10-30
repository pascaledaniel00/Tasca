-- Tasca: gestione strutturata di debiti, pagamenti e fondi risparmio.
-- Eseguire una sola volta nel Supabase SQL Editor prima di usare la nuova sezione.
create table if not exists public.debts (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  creditor text,
  original_principal numeric(12,2) check (original_principal is null or original_principal >= 0),
  principal_remaining numeric(12,2) check (principal_remaining is null or principal_remaining >= 0),
  installment_amount numeric(12,2) check (installment_amount is null or installment_amount >= 0),
  installments_total integer check (installments_total is null or installments_total >= 0),
  installments_remaining integer check (installments_remaining is null or installments_remaining >= 0),
  interest_rate numeric(7,4) check (interest_rate is null or interest_rate >= 0),
  next_due_on date,
  status text not null default 'active' check (status in ('active','paid','paused')),
  notes text,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists debts_space_status_idx on public.debts(space_id,status,next_due_on);
create table if not exists public.debt_payments (
  id uuid primary key default gen_random_uuid(),
  debt_id uuid not null references public.debts(id) on delete cascade,
  space_id uuid not null references public.spaces(id) on delete cascade,
  transaction_id uuid references public.transactions(id) on delete set null,
  amount numeric(12,2) not null check (amount > 0),
  principal_component numeric(12,2) check (principal_component is null or principal_component >= 0),
  interest_component numeric(12,2) check (interest_component is null or interest_component >= 0),
  paid_on date not null,
  notes text,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  constraint debt_payment_components_valid check (
    principal_component is null or interest_component is null
    or principal_component + interest_component <= amount
  )
);
create index if not exists debt_payments_debt_paid_idx on public.debt_payments(debt_id,paid_on desc);
create unique index if not exists debt_payments_transaction_unique
  on public.debt_payments(transaction_id) where transaction_id is not null;

create table if not exists public.savings_goals (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  target_amount numeric(12,2) not null check (target_amount > 0),
  starting_balance numeric(12,2) not null default 0 check (starting_balance >= 0),
  target_date date,
  status text not null default 'active' check (status in ('active','completed','paused')),
  notes text,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists savings_goals_space_status_idx on public.savings_goals(space_id,status);
create table if not exists public.savings_movements (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references public.savings_goals(id) on delete cascade,
  space_id uuid not null references public.spaces(id) on delete cascade,
  transaction_id uuid references public.transactions(id) on delete set null,
  movement_type text not null check (movement_type in ('contribution','withdrawal')),
  amount numeric(12,2) not null check (amount > 0),
  occurred_on date not null,
  notes text,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists savings_movements_goal_date_idx on public.savings_movements(goal_id,occurred_on desc);
create unique index if not exists savings_movements_transaction_unique
  on public.savings_movements(transaction_id) where transaction_id is not null;

-- L'accesso segue i membri dello spazio (incluso il proprietario).
alter table public.debts enable row level security;
alter table public.debt_payments enable row level security;
alter table public.savings_goals enable row level security;
alter table public.savings_movements enable row level security;

do $$
declare t text;
begin
  foreach t in array array['debts','debt_payments','savings_goals','savings_movements'] loop
    execute format('drop policy if exists %I on public.%I', 'space members manage '||t, t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (exists (select 1 from public.space_members sm where sm.space_id = %I.space_id and sm.user_id = auth.uid())) with check (exists (select 1 from public.space_members sm where sm.space_id = %I.space_id and sm.user_id = auth.uid()))',
      'space members manage '||t, t, t, t
    );
    execute format('grant select, insert, update, delete on public.%I to authenticated',t);
  end loop;
end $$;

-- Coerenza tra record collegati: una registrazione non può puntare a uno spazio diverso.
create or replace function public.tasca_validate_finance_link()
returns trigger language plpgsql set search_path = public as $$
declare linked_space uuid;
begin
  if tg_table_name = 'debt_payments' then
    select space_id into linked_space from public.debts where id = new.debt_id;
  else
    select space_id into linked_space from public.savings_goals where id = new.goal_id;
  end if;
  if linked_space is null or linked_space <> new.space_id then
    raise exception 'Lo spazio del movimento non corrisponde allo spazio del record collegato';
  end if;
  if new.transaction_id is not null and not exists (
    select 1 from public.transactions tx
    where tx.id = new.transaction_id and tx.space_id = new.space_id and tx.status = 'confirmed'
  ) then
    raise exception 'Il movimento collegato deve essere una transazione confermata dello stesso spazio';
  end if;
  return new;
end $$;
drop trigger if exists validate_debt_payment_link on public.debt_payments;
create trigger validate_debt_payment_link before insert or update on public.debt_payments
for each row execute function public.tasca_validate_finance_link();
drop trigger if exists validate_savings_movement_link on public.savings_movements;
create trigger validate_savings_movement_link before insert or update on public.savings_movements
for each row execute function public.tasca_validate_finance_link();
