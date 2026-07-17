-- Tessera — durable store.
--
-- Postgres deliberately holds only what Redis shouldn't: identity that should
-- outlive a cache flush, and the immutable record of what happened. It is never
-- read or written inside the claim path — every write arrives via a batched
-- async queue, so a slow or sleeping database can never stall a claim. That is
-- also why a hosted Postgres (Supabase) is fine here: nothing waits on it.

create table if not exists players (
  id            uuid        primary key,
  -- Dense wire index. Allocated by Redis INCR — the hot path needs the
  -- allocation to be cheap and atomic — and mirrored here so indices survive a
  -- flush. 0 is reserved for "unclaimed" and is never assigned.
  idx           integer     not null unique check (idx > 0),
  name          text        not null,
  color         text        not null,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);

-- Append-only. Never updated, never deleted.
--
-- This is the entire event-sourcing story: board state at any instant is a fold
-- over this table in seq order. A timelapse replay is therefore a read of data
-- we already have rather than a feature that needs designing.
--
-- Note the absence of foreign keys. An event is a historical fact — it happened,
-- and it stays true whether or not some dimension row is present. Pointing an FK
-- at a mutable table would let a missing player row reject a batch of events
-- that are, in themselves, perfectly valid. Event logs and referential integrity
-- to live tables are a bad marriage; the join is done at read time instead.
create table if not exists claims (
  id             bigserial   primary key,
  seq            bigint      not null,
  cell           integer     not null check (cell >= 0),
  player_id      uuid        not null,
  player_idx     integer     not null,
  -- 0 means the cell was unclaimed: this was settlement, not a steal.
  prev_player_idx integer    not null default 0,
  stolen         boolean     not null,
  created_at     timestamptz not null default now()
);

-- Replay reads the log in seq order.
create index if not exists claims_seq_idx on claims (seq);
-- "What happened in the last N minutes", for stats and debugging.
create index if not exists claims_created_at_idx on claims (created_at desc);
-- Per-player history.
create index if not exists claims_player_idx on claims (player_id, created_at desc);
