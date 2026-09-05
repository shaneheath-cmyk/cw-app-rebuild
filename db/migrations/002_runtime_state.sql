create table cw_runtime_state (
  id boolean primary key default true check (id),
  state jsonb not null,
  updated_at timestamptz not null default now()
);
