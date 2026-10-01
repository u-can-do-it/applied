-- Run once in Supabase → SQL Editor.

create table if not exists public.offers (
  src        text        not null,          -- eldorado | justjoin | solidjobs | builtin | bulldog | nofluff
  id         text        not null,          -- the source's own offer id
  title      text        not null,
  company    text,
  seniority  text,
  remote     boolean,
  url        text        not null,
  first_seen timestamptz not null default now(),  -- when Node-RED first saw it ("last pushed")
  primary key (src, id)
);

create index if not exists offers_first_seen_idx on public.offers (first_seen desc);

-- RLS on with no policies: the anon/publishable key can't read or write anything.
-- Node-RED and the Vercel app both use the secret key, which bypasses RLS.
alter table public.offers enable row level security;

-- make the REST API pick up the new table right away
notify pgrst, 'reload schema';
