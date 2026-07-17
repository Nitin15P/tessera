# Tessera

A real-time shared board. 1500 tiles, no signup, everyone on the same grid.

- **Empty tile** — click it, it's yours.
- **Someone else's tile** — click it, find the odd shape, take it.
- **Four charges**, one refilling every ~1.2s — burst when you want, enforced by
  the server.

---

## Run it

```bash
brew services start redis     # the only hard dependency
npm install
npm run build
npm start                     # http://localhost:8080
```

Open it in two windows to see the point. Postgres is optional — see
[Why two databases](#why-two-databases).

```bash
npm run dev        # vite + tsx watch, frontend on :5173
npm run verify     # the three tests below
```

---

## The actual problem

The grid isn't the hard part. This is:

> You and I both click tile 47 within 10ms of each other. My browser is told I
> won. Your browser is told you won. Nothing crashes, no error appears — we just
> quietly have two different boards, forever.

That's the failure this whole design exists to prevent, and it's worth naming
precisely, because it isn't "a crash" or "a race condition" in the abstract. It's
**divergence**: the system continuing to run smoothly while lying to somebody.

The naive handler causes it:

```
1. read tile 47      -> unclaimed
2. decide            -> valid
3. write owner
4. tell everyone
```

Interleave two of those and both read `unclaimed` at step 1 before either writes
at step 3. Both are told they won. The gap between the check and the write is
where the bug lives, and the only fix is to make them inseparable.

## How it's fixed

**The claim is a Lua script, executed by Redis as one indivisible unit**
([`backend/src/db/redis/scripts/claim.lua.ts`](backend/src/db/redis/scripts/claim.lua.ts)). Redis runs a script to
completion before any other command from any other client, so there is no window
for a second claim to slip into. It refills and checks the player's charge
bucket, reads the tile, writes the owner, bumps the sequence, updates the
leaderboard, and publishes the change — all or nothing. The pacing rule and the
tile write are the *same* indivisible operation, so a claim can never succeed
without being paid for, or charge without succeeding.

I considered relying on **Node's single-threaded event loop** instead: a handler
with no `await` in it can't be interrupted, which is a real guarantee and would
have worked. I didn't, because it only holds for **one process**. The moment
there's a second instance behind a load balancer — which "deployed" implies — it
evaporates silently. Pushing atomicity into Redis means correctness doesn't
depend on how many servers happen to be running. `npm run test:cross` proves that.

One deliberate detail: a charge is **checked but only spent on success**. A
rejected click must not cost you one — losing a race is punishment enough.
Checking and spending separately would be a race anywhere else; inside the
script, nothing can run between the two.

### Why a bucket, not a flat cooldown

The first version used a flat 3-second cooldown, and it made the game feel dead —
which is worth explaining, because the reason is the whole point of the app.

A rate limit's job is to cap how fast the *board* changes, but the board's
liveliness is roughly `players ÷ limit`. r/place used a **five-minute** cooldown
and still felt frantic, because it had millions of people. At the handful of
concurrent players this actually runs with, 3 seconds meant ~0.67 claims/sec
across the entire board — an app whose whole premise is "everyone sees changes
instantly", with nothing to see. The rule was suppressing the exact thing it
exists to demonstrate.

A **token bucket** (4 charges, one back every 1.2s) fixes the shape as well as
the number. A flat gate punishes your first click as hard as your fiftieth; a
bucket lets you *burst* — which is when the game feels responsive — and only
bites under sustained spam, which is when you actually want it to. It's the same
one-sentence rule and about fifteen extra lines of Lua, and because it rides
inside the claim script the atomicity is free.

What it still prevents is narrow and intact: at ~0.83 sustained claims/sec, one
person needs ~30 minutes of uninterrupted frantic clicking to fill 1500 tiles, in
full view of everyone who can steal them back. The anti-grief and anti-bot
protection survives; the deadness doesn't. The refill maths lives once, shared by
every script that needs it ([`bucket.lua.ts`](backend/src/db/redis/scripts/bucket.lua.ts)),
and the clock is Redis's own `TIME` so two instances can't enforce subtly
different rules.

## Architecture

```
Browser  ── React shell + canvas board
   │        WebSocket (ordered, reliable)
Node    ── stateless; keeps a local read mirror
   │
Redis   ── authoritative state · atomic claim (Lua) · pub/sub fan-out
   │
Postgres ─ durable identity · append-only claim log
```

### Why `ws` and not Socket.IO

Socket.IO gives you rooms and reconnection for free. That's exactly the problem:
the brief says it's grading real-time thinking, and Socket.IO would have done
that thinking for me. The protocol, sequencing, batching and reconnect logic here
are all visible and arguable. It cost about 60 lines.

### Why two databases

Because they're good at opposite things, and the claim path only needs one of
them.

**Redis is the source of truth for live state** — not a cache. It's where the
board is, where the atomic claim happens, and how instances hear about each
other. It's fast and volatile.

**Postgres is the durable record** — identity that should outlive a flush, and an
append-only log of every claim. It is *never touched inside the claim path*.
Writes leave on a batched timer, so:

- a slow database cannot slow a claim down;
- a **missing** database cannot take a claim down.

`DATABASE_URL` unset, host asleep, network gone — the board keeps working and
only the log stops recording. That's not a fallback I bolted on; it's the reason
the split exists. Supabase's free tier pauses a project after 7 days idle, so for
a submission someone might open in a fortnight, *degraded* is the expected state
and the app is built to shrug at it.

That log is also the whole event-sourcing story: board state at any instant is a
fold over `claims` in `seq` order. A timelapse replay is therefore a **read of
data I already have**, not a feature that needs designing — which is why I logged
the events but didn't build the replay UI (see [What I didn't
build](#what-i-didnt-build)).

### Why canvas

At 1500 tiles, divs would have been fine. I'm not going to pretend otherwise.

Canvas is here because rendering cost becomes a function of **what changed**, not
how big the board is — the architecture the app would need at 50,000 tiles — and
because it forces one grid state and one render function instead of state
scattered across 1500 components. React is not in the paint path at all: the
renderer reads the store's arrays on its own rAF loop, and the board can change
20 times a second without React knowing.

The cost is real and I'm not hiding it: **a canvas is opaque to screen readers**.
The board is unusable without sight. The honest fix is a parallel keyboard/ARIA
grid, which this project doesn't do. Known gap, consciously accepted.

---

## Real-time details worth pointing at

### Subscribe *then* snapshot — at both layers

A client joins. The server reads the board and sends it. In the gap between the
read and the socket being registered for broadcasts, someone claims a tile. That
client never hears about it, and sits on a silently wrong board until they
refresh.

So registration always comes **first**, then the read
([`realtime/lifecycle.ts`](backend/src/realtime/lifecycle.ts)). The worst case flips from *lost
update* to *duplicate update*, and applying an update twice is idempotent —
setting a tile to X twice is setting it to X. Losing one is permanent. Take the
duplicate every time.

The same bug and the same fix appear again one layer down, when each Node
instance hydrates its mirror from Redis ([`services/board.service.ts`](backend/src/services/board.service.ts)):
subscribe to pub/sub, *then* `HGETALL`, then replay what arrived in between.

### …but the two layers need different handling

This is the part that would be easy to get wrong by pattern-matching:

- **Redis pub/sub is fire-and-forget.** No redelivery. The server genuinely can
  miss a message, so it watches for `seq` gaps and re-hydrates when it finds one.
- **A WebSocket is ordered and reliable** while it's open. A client *cannot* miss
  a patch mid-connection — if delivery fails, the connection fails, and reconnect
  brings a fresh snapshot. So there's no gap detection on the client, because
  there's no gap to detect. Copying the server's solution here would be cargo
  cult.

Same-looking problem, different guarantees, different answer.

### Batching: 20Hz, not per-event

Changes are coalesced onto a 50ms tick and flushed as one patch
([`realtime/ticker.ts`](backend/src/realtime/ticker.ts)).

With 30 people clicking hard, per-event delivery is ~300 tiny frames/sec at every
client. Batching bounds it to **20 frames/sec regardless of how busy the board
is**, and a tile touched five times inside one window costs the same as a tile
touched once — only the final owner ships. Load stops being a function of how
frantic the players are.

### Optimistic UI with no rollback code

Two layers ([`state/store.ts`](frontend/src/state/store.ts)):

```
confirmed   what the server last said. The truth.
pending     what we're hoping for. A guess, with a timestamp.
```

Render is `confirmed` with `pending` painted over at ~70% opacity and a slow
pulse — the UI should look like it's *hoping*, not asserting. When the server
answers, **win or lose**, the pending entry is deleted.

There is no rollback path, because there's nothing to roll back: stop overriding
and the truth is already underneath, correct by construction. If you lost the
race, the tile quietly becomes the winner's colour. That property is the entire
reason for splitting the two rather than optimistically mutating one grid.

Pending entries are also swept on a timer, because a *reply* can be lost even
when a patch can't — the socket can die between our send and the server's answer.
Without that sweep, a dropped response leaves a tile showing your colour forever,
which is the exact divergence the server works so hard to prevent. It would be
embarrassing to import the bug on the client.

### Wire format

Tiles store an owner **index**, not a colour or a name. The whole board is a
`Uint16Array` — 3KB, one base64 blob — instead of ~50KB of repeated hex strings.
It also means a player's colour exists in exactly one place, so a tile *cannot*
disagree with its owner.

```ts
{ t:"claim",     cell, req }          // free land
{ t:"challenge", cell, req }          // owned land — request a challenge
{ t:"solve",     req, cell, idx }
{ t:"cursor",    x, y }               // normalised 0..1, throttled to 20Hz

{ t:"welcome",   you, w, h, bucketMax, refillMs, token }
{ t:"snapshot",  seq, grid:"<base64>", players }
{ t:"patch",     seq, cells:[[cell, owner]], players? }
{ t:"claimResult", req, ok, cell, reason?, charges, nextChargeMs }
```

`req` correlates a response to the click that caused it, so a rejection clears
exactly the right optimistic tile. `seq` is global and bumped on every state
change; snapshots are stamped with the seq they were read at. Every
`claimResult` carries the server's `charges` count — accepted or rejected — so
the client's charge pips are corrected on every single interaction rather than
being left to drift; the client predicts refill locally only to animate smoothly
in between.

---

## The steal challenge

Free land is free. Taking someone's land shouldn't be — so stealing costs a
one-second "odd one out": nine shapes, one differing in hue or rotation.

It's built to have three properties: **no prior knowledge** (not arithmetic, not
language — someone who's never seen the app is on equal footing with someone
who's played for an hour), **about one second** (a steal is a beat in a fast
game, not a puzzle break), and **latency-independent**. That last one ruled out
the obvious "click when the bar hits the zone" reflex design: it would make a
player on a slow connection genuinely worse at the game, which is a grotesque
property for a real-time app to have.

**What it does not do is resolve conflicts.** Two players can both solve
challenges for the same tile; the atomic script still decides who gets it. A
puzzle in front of a claim moves the race, it doesn't remove it. Worth being
blunt about, because it's an appealing thing to believe.

And the script decides it the intuitive way: **first solver wins.** A steal is a
compare-and-swap — the challenge records who owned the tile when it was issued,
and the solve only lands if the tile is *still* owned by that player. If someone
solved faster and took it first, the owner has moved, and the slower solver is
rejected with `taken` (keeping their charge — they solved honestly, they were
just too slow). This makes a steal symmetric with claiming free land: free land
is "write me only if still unclaimed", a steal is "write me only if still owned
by whoever I challenged". Both are first-to-commit-wins. An earlier version let
the *last* solver overwrite the first, which rewarded solving slowly and was
inconsistent with the rest of the game — `npm run test:steal` pins the corrected
behaviour.

**Nor is it cheat-proof.** The answer never leaves the server — it's compared
inside the Lua script against what Redis holds — but the tray is *rendered* on
the client, so a script can diff the shapes and click for you. I did exactly that
while testing this, in one line of console JS. That's unavoidable for any
client-rendered visual challenge. **The charge bucket is the real backstop**: a
perfect bot still averages one steal every ~1.2 seconds and can't sustain more. Better to say so than to claim a
guarantee that isn't there.

---

## Tests

The three things worth proving, all runnable (`npm run verify`, server up):

### `npm run test:race` — the headline

Fifty independent sockets click the same free tile in the same instant.

```
  winners            1
  losers             49  taken:49
  no reply           0
  redis owner        1
  distinct views     1 (1)

  PASS  exactly one winner
  PASS  every other request rejected
  PASS  all rejections are 'taken'
  PASS  redis owner is the winner
  PASS  all clients converged on one owner
  PASS  clients agree with redis
```

That last pair is the one that matters. A system can pick a winner correctly and
still tell people different stories about it — **distinct views: 1** is the proof
that it doesn't.

### `npm run test:bucket` — the rule lives on the server

Bypasses the UI entirely and fires claims straight down the socket, which is what
a cheating client would do. The burst is the property worth proving: a flat
cooldown would have let exactly one through.

```
  accepted           4
  refused            4
  charges reported   0
  after ~1 refill    1 of 2 accepted

  PASS  burst of 4 accepted at once
  PASS  the rest refused for no charges
  PASS  server reports an empty bucket
  PASS  one refill buys exactly one claim, not two
  PASS  claiming your own tile is rejected
  PASS  a rejection does not spend a charge
  PASS  out-of-range tiles are dropped at the boundary
```

### `npm run test:steal` — stealing is first-solver-wins

Tile owned by A. B and C both open a challenge and both solve correctly; B's
solve reaches Redis first.

```
  B (first solver)    won
  C (second solver)   rejected: taken
  final owner         2   (B=2, C=3)
  C's charges after   4

  PASS  the first solver wins the tile
  PASS  the second solver is told 'taken'
  PASS  the second solver keeps their charge
  PASS  everyone converged on one owner
```

### `npm run test:cross` — the architecture is real

Two Node instances, one Redis. A claim on A must reach a player on B, whose
process knows nothing about A.

```
  PASS  instance A published the claim
  PASS  instance B received it without touching A
  PASS  both instances agree
```

Start a second instance with `PORT=8081 npm start`. If this passes, the
backend is genuinely horizontally scalable rather than only working because
everything happened to be in one process.

---

## What I didn't build

Each of these was considered and declined, which I'd rather record than leave
looking like an oversight:

- **Enclosure / area capture (paper.io-style).** The most tempting one. It turns
  a single-row atomic write into a multi-cell transaction — one click can flip
  200 tiles — with genuinely ambiguous conflict semantics when two loops close at
  once, and it forces the same flood-fill algorithm into both client and server
  where any divergence renders as a visibly wrong region. Airtight concurrency on
  the simple model is worth more than a fragile version of the complex one.
- **Adjacency and tile hardening.** Rule overload is a design failure, not just a
  scope one. Three overlapping rules is mush; nobody holds "wait 3s, and only
  touch my territory, and it's harder if the tile is old, and also solve a
  puzzle" in their head. The steal challenge already does hardening's job.
- **Timelapse replay UI.** The log is there and the fold is trivial. This is the
  first thing I'd build with more time.
- **Zoom/pan.** 1500 tiles fit on a screen. Solving a problem I chose not to have.
- **Accounts.** The token in `localStorage` identifies a *browser*, not a person.
  Clear storage and you're someone new; copy the token and you're the same player.
  For a public board with nothing at stake, that's the right amount of security —
  and saying so is better than implying more.

## What changes at 10,000 concurrent

Honestly, the claim path mostly doesn't — it's one Lua script, and Redis will do
~100k of those a second. What breaks first is everything around it:

1. **Fan-out.** 10k sockets × 20Hz = 200k messages/sec, and right now each patch
   is serialised per client. The fix is to serialise once per tick and reuse the
   buffer, which needs the per-client `players` field to move into a separate
   broadcast.
2. **Presence.** Sending the full online list every second is O(n) per client per
   second — quadratic overall. It'd become a count plus deltas.
3. **Pub/sub.** Every instance receives every change. That's fine to a point;
   past it, the board would shard by region and instances would subscribe only to
   the regions their clients are looking at.
4. **The mirror.** Fine — it's 3KB. It scales to a much bigger board before it
   isn't.

None of that is built, because none of it is needed at the scale this actually
runs at, and building it anyway would be the wrong instinct.

## Layout

Four top-level concerns, each with one job.

```
shared/                  the wire contract, imported verbatim by both sides
  protocol/              messages · constants · codec
  domain/                types · grid geometry · palette

backend/
  config/                env parsed once, at the edge · runtime path anchoring
  domain/                pure game rules — challenge trays, names. No I/O.
  db/                    ← persistence. Nothing above here writes a query.
    redis/               client · keys · scripts/ (the Lua) · repositories/
    postgres/            pool · migrate · repositories/
  services/              orchestration: claim · board (the mirror) · player · eventLog
  middleware/            ← the inbound pipeline every message passes through
  realtime/              lifecycle · broadcaster · ticker · dispatch · handlers/
  http/                  static · health
  app.ts                 wiring
  main.ts                process boundary: signals, and nothing else

frontend/
  app/                   App · Sidebar · useStore · styles
  features/
    board/               Board.tsx + renderer/ (geometry, layers/)
    challenge/ presence/ leaderboard/ status/
  net/                   socket: sequencing, buffering, reconnect
  state/                 store: confirmed vs pending — the optimistic model

db/migrations/           versioned SQL, applied at boot
backend/test/            race · bucket · steal · crossInstance
```

### The layering rules

Three, and they're what the directories are actually for:

1. **`domain/` is pure.** No Redis, no sockets, no clock. Challenge generation is
   a function from nothing to a tray, which is why it can be reasoned about
   without a running server.
2. **`db/` owns every query and key name.** Services ask repositories for tiles
   and players; they never see `HGET` or `cd:{playerId}`. The Lua lives here too,
   because it *is* storage — the atomicity is a property of Redis, not of us.
3. **`realtime/` is transport only.** Handlers translate a message into a service
   call and a reply. The rules aren't in them. That matters beyond tidiness: a
   second transport couldn't accidentally implement different rules, and the
   claim rule can be exercised without opening a socket.

### Why middleware is a layer

Every inbound message runs the same chain before any handler sees it:

```
errorBoundary -> rateLimit -> parseAndValidate -> dispatch
```

These concerns previously existed but were smeared across the connection
handler — a budget decrement in a closure, `inBounds` re-checked inside each
handler, a `JSON.parse` try/catch beside the switch. It worked, but you couldn't
answer "what protects this socket?" without reading everything, and the
guarantee was only ever as good as the least careful handler.

Now the boundary validates and the interior trusts. A new handler gets the error
boundary, the budget, and range-checked input for free rather than by
remembering. Two things worth knowing about the chain:

- **`rateLimit` is not the game rule.** The charge bucket is the game rule, it
  lives in Lua, and it's what paces a player. The middleware rate limit is one
  layer down and exists only to stop a socket drowning the process in parse work.
  Conflating them would break both: a rate limit enforcing pacing is bypassable
  with a second socket, and a game rule doubling as a resource guard has to be
  tuned for two incompatible jobs.
- **Rejection is silent.** Invalid input gets no reply — a misbehaving client
  isn't owed an explanation, and answering a flood amplifies it. That's a real
  behavioural contract, so `npm run test:bucket` pins it.

**Stack:** TypeScript everywhere · Node + `ws` · Redis (ioredis) · Postgres (pg) ·
React + Vite · canvas · npm workspaces.
