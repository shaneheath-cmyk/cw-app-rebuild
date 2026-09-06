alter table audit_event add column actor_label text not null default 'user';

create table catalogue_work (
  id uuid primary key, title text not null, author text not null,
  status text not null check (status in ('draft', 'editorial', 'production', 'released')),
  formats text[] not null default '{}', digital_product_code text not null default '',
  kdp_url text not null default '', hardcover_display_price_cents integer not null default 0 check (hardcover_display_price_cents >= 0),
  created_at timestamptz not null default now()
);

create table deposit_parse (
  id uuid primary key, deposit_id uuid not null unique references source_deposit(id),
  word_count integer not null check (word_count >= 0), headings text[] not null default '{}',
  suggested_title text not null default '', suggested_author text not null default '',
  confidence text not null check (confidence in ('low', 'medium', 'high')),
  actor_id uuid references app_user(id), created_at timestamptz not null default now()
);

create table user_session (
  token_hash char(64) primary key, user_id uuid not null references app_user(id) on delete cascade,
  expires_at timestamptz not null, created_at timestamptz not null default now()
);
create index user_session_expiry_idx on user_session(expires_at);
create index audit_event_recent_idx on audit_event(created_at desc);
create index catalogue_work_status_idx on catalogue_work(status);
