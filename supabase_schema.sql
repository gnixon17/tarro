-- Optional Postgres/Supabase backend for Tarro.
--
-- The app keeps the whole portfolio as one JSON document: it is small, every
-- page reads all of it, and writing it atomically means a save can never leave
-- positions pointing at an account that no longer exists. Set SUPABASE_URL and
-- SUPABASE_KEY and the server uses this table instead of ./data/portfolio.json.

create table if not exists app_state (
  id         text primary key,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

-- The server writes a single row with id = 'portfolio'.
insert into app_state (id, data)
values ('portfolio', '{}'::jsonb)
on conflict (id) do nothing;

-- Row-level security.
--
-- Tarro is a single-user tool with no auth layer of its own, so the anon key
-- would otherwise expose the whole portfolio to anyone who has it. Enable RLS
-- and serve the app with a service-role key from the server, or add a policy
-- keyed to your own auth.uid() and store one row per user.
alter table app_state enable row level security;
