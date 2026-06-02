alter table public.cashflow_entries
  add column if not exists source_account_id uuid references public.accounts(id) on delete set null,
  add column if not exists target_account_id uuid references public.accounts(id) on delete set null,
  add column if not exists transfer_group_id uuid;

create index if not exists cashflow_entries_transfer_group_id_idx
  on public.cashflow_entries (transfer_group_id);

create index if not exists cashflow_entries_source_account_id_idx
  on public.cashflow_entries (source_account_id);

create index if not exists cashflow_entries_target_account_id_idx
  on public.cashflow_entries (target_account_id);
