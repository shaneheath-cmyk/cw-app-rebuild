create table cw_request_counter (
  subject text primary key,
  attempts integer not null check (attempts >= 0),
  window_started timestamptz not null default now()
);
