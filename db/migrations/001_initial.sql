-- Production target schema. Apply through the Pax Node 1 PostgreSQL migration runner.
-- The JSON file store is development-only and is intentionally not a replacement for this schema.

create table app_user (
  id uuid primary key,
  email text not null unique,
  password_hash text not null,
  roles text[] not null check (cardinality(roles) > 0),
  created_at timestamptz not null default now()
);

create table source_deposit (
  id uuid primary key,
  submitted_by uuid not null references app_user(id),
  filename text not null,
  sha256 char(64) not null,
  declared_rights text not null,
  intended_title text not null default '',
  intended_author text not null default '',
  status text not null check (status in ('staged', 'retrieved', 'parsed', 'accepted', 'rejected')),
  created_at timestamptz not null default now(),
  retrieved_at timestamptz,
  retrieved_by uuid references app_user(id),
  unique (sha256)
);

create table editorial_task (
  id uuid primary key,
  deposit_id uuid references source_deposit(id),
  type text not null,
  status text not null check (status in ('open', 'in_progress', 'approved', 'rejected', 'completed')),
  assignee_role text not null,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references app_user(id)
);

create table commerce_event (
  stripe_event_id text primary key,
  event_type text not null,
  received_at timestamptz not null default now()
);

create table customer_order (
  id uuid primary key,
  stripe_session_id text not null unique,
  customer_email text not null,
  product_code text not null,
  amount_cents integer not null check (amount_cents > 0),
  currency char(3) not null check (currency = 'aud'),
  status text not null check (status in ('paid', 'refunded', 'disputed')),
  created_at timestamptz not null default now()
);

create table entitlement (
  id uuid primary key,
  order_id uuid not null references customer_order(id),
  kind text not null,
  status text not null check (status in ('active', 'revoked')),
  created_at timestamptz not null default now()
);

create table audit_event (
  id uuid primary key,
  type text not null,
  subject_id text not null,
  actor_id uuid references app_user(id),
  created_at timestamptz not null default now(),
  detail jsonb not null default '{}'::jsonb
);

create index source_deposit_status_idx on source_deposit(status, created_at);
create index editorial_task_queue_idx on editorial_task(status, assignee_role, created_at);
create index entitlement_order_idx on entitlement(order_id);
