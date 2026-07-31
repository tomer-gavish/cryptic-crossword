# Realtime multiplayer for the cryptic-crossword solver

## Context

`cryptic-crossword` is a fork of [Dvd848/cryptic-crossword](https://github.com/Dvd848/cryptic-crossword): a
deliberately lightweight, **100% static** solver — vanilla TypeScript + Bootstrap, webpack bundle committed to
`dist/` by a GitHub Action, served from GitHub Pages. Progress is saved to `localStorage`. The fork already
diverges in one way: `?id=<32+ hex>` loads a crossword from
`https://storage.googleapis.com/cryptic-crossword/crosswords/<id>.json`, fed by the `upload_crossword` Cloud
Function in the sibling `CrosswordDigitization` repo.

Now that digitization is nearly done, the solver should become genuinely the user's own, and the headline
feature is **cooperative realtime multiplayer** — several people solving one crossword together, seeing each
other's letters and cursors live. `localStorage` obviously can't do that, so the question is what backend shape
this needs and how much of the solver has to be torn up.

**Answer up front: very little.** The solver already has a clean single seam for all state (`StorageContext`)
and already supports a *second* state provenance (the `?state=` share link). Multiplayer slots in behind that
seam. No rewrite, no framework, and the site stays static on GitHub Pages.

---

## The three questions asked, answered

**"Can I use Cloud Functions to manage the multiplayer game?"**
Not for the realtime transport. HTTP Cloud Functions are stateless request/response with no persistent
connection — you'd have to poll. At 1s polling with 4 players that's ~14k invocations/hour per room and it
*still* feels laggy against a typing cursor. Cloud Functions remain the right tool for out-of-band chores
(scheduled room cleanup), and with the recommended design you don't even need that for v1.

**"Do I have to implement a backend?"**
No. A managed realtime database *is* the backend. You'd only need your own server if you wanted
server-authoritative rules — and a cooperative crossword has no cheating threat model (the solutions ship
inside the client JSON already).

**"How would it change the deployment phase?"**
For the solver: essentially not at all. Still `npm run build` → `dist/` → GitHub Pages, same Action. The only
addition is a `database.rules.json` deployed once with `npx firebase deploy --only database`, plus enabling
Firebase on the **GCP project you already have**. Cloud Run, the upload function, and the bucket are untouched.

---

## Recommendation: Firebase Realtime Database

**Rationale:** it lives inside the GCP project already in use (no new vendor, billing account, or IAM story);
it has native `onDisconnect()` — the thing that makes presence/cursors actually work when someone closes a
tab, and which Firestore lacks; it's built for many tiny high-frequency writes, which is exactly what
per-keystroke sync is; its free tier (100 concurrent connections, 1 GB, 10 GB/mo egress) dwarfs a hobby app;
and the SDK's offline write queue gives reconnect handling for free. The solver stays a static site.

### Alternatives considered

| Option | Latency | Cost @ hobby | Ops burden | Deploy change | Fit |
|---|---|---|---|---|---|
| **Firebase RTDB** ✅ | ~50–150ms | Free | None | Rules file only | Same GCP project; native presence |
| Firestore | ~100–300ms | Free-ish | None | Rules file only | No `onDisconnect`; per-op pricing punishes per-keystroke writes; 1 write/s/doc soft limit |
| Cloud Functions + polling | 1–3s | Low but grows | Low | New function | Not realtime. Rejected as primary |
| Own WebSocket server on Cloud Run | Best | ~$5–15/mo | **High** | New stateful service | Multi-instance fanout problem: two players in one room can land on different instances. Needs `min=max=1` (no HA, cold starts) or Redis/Pub/Sub |
| Cloudflare Durable Objects / PartyKit | Best | ~$5/mo min | Low | New vendor + deploy pipeline | Technically the *cleanest* fit — one authoritative object per room — but a second cloud to operate |
| Supabase Realtime / Ably / Liveblocks | Good | Free tier | Low | New vendor | Fine, but no advantage over RTDB given the existing GCP footprint |

**Decisions (all settled):**
- Stay on GCP → Firebase RTDB (see *Why not Firestore* below).
- **Anonymous auth + nickname now, upgradeable to real accounts later** — see *Identity* below.
- **One shared grid** — a single authoritative room state. Letters record who typed them (`by`), enabling
  per-player attribution.
- **Shared truth, private view**: every player always writes to the room; the "advance on my own" toggle
  controls only what *your* screen renders. See *Reveal policy* below.
- **Rooms are created in the solver**, on demand, via a "solve together" button. `CrosswordDigitization` stays
  decoupled — its job still ends at uploading JSON to the bucket.
- **Solutions are an optional capability** — graceful degradation when absent, no key capture, no crowd-derivation.
- **Text scratchpads ship in v1**, shared and synced (not private). Voice notes deferred, schema reserved.
- **Mobile clue view ships after multiplayer.**

### Why not Firestore

Two real points in Firestore's favour, neither decisive here:

- **Offline.** True: RTDB's web SDK queues writes in memory while the tab lives but has no on-disk
  persistence; Firestore caches to IndexedDB. But trace the scenario — a mid-session disconnect is already
  handled (tab alive, puzzle loaded, writes queue and flush on reconnect). Firestore only wins on *close the
  tab offline, reopen still offline*, and in that case the puzzle JSON fetch from `storage.googleapis.com`
  fails too, so there's nothing to render either way. Real offline support here means a service worker caching
  the puzzle JSON plus the localStorage mirror already in this plan — not a different database.
- **Presence.** Also true, and worse than "not native": Google's own documented Firestore presence solution is
  *"use Realtime Database for presence and mirror into Firestore via a Cloud Function."* Picking Firestore
  means running RTDB anyway, or heartbeat+TTL with ghost cursors lingering until timeout.

**The decisive argument is the billing model.** Firestore bills per document read/write; RTDB bills bandwidth
and storage. Multiplayer crossword is a firehose of tiny writes:

| Per session | Firestore | RTDB |
|---|---|---|
| 500 letters typed, 4 players | 500 writes + ~2,000 reads (fan-out) | ~40 KB |
| Presence heartbeat, 4 players × 30 min | ~500 writes + ~2,000 reads | ~2 KB |
| **Cursor movement at ~5/sec** | **~9,000 writes + ~36,000 reads** | **~500 KB** |

Free tier is 20k writes / 50k reads per *day*. Cursor sync alone exhausts it in a session or two, forcing you
to throttle cursors and degrade the feature. On RTDB the whole session is a rounding error against 10 GB/month.
Firestore's ~1 write/sec/document soft limit also forces one document per cell, making a room load ~140 reads.

"Firestore is preferred for new projects" is about it being the better general-purpose *document database* —
queries, composite indexes, structured app data. It is not a claim about low-latency ephemeral sync. RTDB is
not deprecated; Google still recommends it for exactly presence and high-frequency small-payload sync.

**Expected end state: both, in this order.** v1 is RTDB only — it owns the hot path (cells, cursors,
presence). When real accounts, "my puzzles" history and a games list arrive, add Firestore *alongside* for
that durable, queryable data. That's the officially-sanctioned split, and deferring it means not paying the
two-SDK complexity tax until it buys something.

### Identity: anonymous now, accounts later

Firebase Auth supports **anonymous account upgrading**: `linkWithPopup(user, googleProvider)` turns an
anonymous account into a permanent one **keeping the same `uid`**. Not a migration — the same identity gains
credentials, so every `by:` attribution and room membership stays valid with zero data rewriting. This is an
Auth-level feature, independent of the database choice.

Two rules keep that door open:
- **Key everything on `uid`, never on "is anonymous".** No `isGuest` flag in the schema; rules say
  `auth != null`, not `auth.token.firebase.sign_in_provider == 'anonymous'`.
- **The nickname is room-scoped profile data, not identity** — it lives at `presence/{uid}/name`. When
  accounts land, a global `users/{uid}/displayName` becomes the default and the room-scoped value becomes an
  override.

Adding login later is then a button, not a refactor.

---

## Conflict model — the one design decision that matters

The current state struct is **one string per row**:

```ts
// Display.ts:80
type StorageContextStruct = {
    input: string[],                                // "?????א??" per row
    solved_clues: { across: string, down: string },  // "0"/"1" per clue id
    version: string
}
```

Syncing that blob would be a whole-document last-write-wins: two players typing in *different* cells would
clobber each other. **The sync unit must be the cell**, keyed `"<row>_<col>"`. Per-cell LWW then needs no CRDT
machinery — concurrent writes to different cells are independent, and concurrent writes to the *same* cell
resolve to the last one, which is exactly what a person sitting at a table would expect.

Keep the row-string format for `localStorage` and the `?state=` share link (backwards compatible); convert at
the room boundary.

### RTDB schema

```
rooms/{roomId}/
  meta/      { crosswordId, source: "external"|"local", rows, cols,
               createdAt, createdBy: <uid>, lastActiveAt }
  cells/     "3_7": { ch: "א", by: <uid>, at: <ts> }        // key deleted when cleared
  solved/    "across_12": { v: true, by: <uid>, at: <ts> }
  presence/  {uid}: { name, color, row, col, dir, at }       // onDisconnect().remove()
  notes/     "across_12"/{noteId}: { by, at, kind: "text", text }
             //  ^ clueKey = "<direction>_<clueId>". `kind` is reserved now so voice
             //    notes ({ kind: "voice", audioUrl, durationMs }) slot in with no migration.
```

The reveal-policy toggle is **not** in the schema — it is a local view preference in `localStorage`, since it
changes nothing another player needs to know. (If it ever should be visible — "Tomer is solving heads-down" —
it belongs in `presence/{uid}`, which is already a per-player node.)

`roomId` = `push().key` (20 chars of ordered randomness) → unguessable, so **the link is the capability**.
Anyone with the link can edit; that is the feature. Say so in the share modal.

### Security rules (`database.rules.json`)

```json
{ "rules": { "rooms": { "$roomId": {
  ".read":  "auth != null",
  ".write": "auth != null",
  "cells": { "$cell": {
    ".validate": "$cell.matches(/^[0-9]+_[0-9]+$/) && newData.hasChildren(['ch','by','at'])",
    "ch": { ".validate": "newData.isString() && newData.val().length <= 1" },
    "by": { ".validate": "newData.val() === auth.uid" }
  }},
  "presence": { "$uid": { ".write": "auth.uid === $uid" } },
  "notes": { "$clueKey": { "$noteId": {
    ".write": "auth != null && (!data.exists() || data.child('by').val() === auth.uid)",
    "by":   { ".validate": "newData.val() === auth.uid" },
    "text": { ".validate": "newData.isString() && newData.val().length <= 2000" }
  }}},
  "meta": { ".write": "auth != null && (!data.exists() || newData.child('createdBy').val() === data.child('createdBy').val())" }
}}}}
```

Notes are **readable by the whole room** (covered by the room-level `.read`) but **only editable and deletable
by their author** — anyone can add a note, nobody can rewrite yours.

### Joining with existing solo progress

Reuses the existing `forceFlushContext()` backup convention (`Display.ts:304`) and the `#share_actions` banner
already in `index.html:48`:

- Room is **empty** (you just created it) → seed it from your `localStorage` state in one atomic `update()`.
  "I solved half of it alone, now let's finish together" just works.
- Room is **non-empty** → the room is the source of truth; back up your solo state to
  `crossword_<id>_backup` and show the banner offering *"ייבוא ההתקדמות שלי"* — a merge that fills only cells
  the room has empty.
- **Offline** → the RTDB SDK queues writes locally and flushes on reconnect. Also mirror to
  `crossword_<id>__room_<roomId>` so a cold offline load still shows the last known grid.

---

## Refactor: what actually changes in `Display.ts`

`Display.ts` is 1475 lines and does everything, but multiplayer only needs **three seams cut**. Roughly 220
lines *moved* and ~60 lines *edited*. This is additive, not a rewrite.

1. **Extract the storage class.** `class StorageContext` (`Display.ts:95–313`) moves out verbatim to
   `src/state/LocalStorageContext.ts`. Define `interface ICrosswordState` from its existing public surface
   (`init`, `getLetter`, `setLetter`, `setClueSolved`, `getClueSolved`, `getState`, `getCurrentStorageSource`,
   `getPrimaryStorageSource`, `forceFlushContext`) plus one new method: `onChange(cb)`.

2. **Split the write path.** `setGridText(textElement, letter)` (`Display.ts:1291`) currently paints the SVG
   *and* writes to `storageContext.setLetter(this.clickContext.activeCoordinate, ...)` — an **implicit**
   coordinate that isn't the one belonging to the element passed in. (This is a latent bug: at
   `Display.ts:893`, initial paint calls it with `activeCoordinate == null`, silently no-opping the write.)
   Split into:
   - `paintCell(coord, letter)` — pure render (text content, red/black fill for latin, the ם→מ final-letter
     mapping), no storage write;
   - `applyLetter(coord, letter)` — `paintCell` + `storageContext.setLetter(coord, letter)`.

   Update the key handler (`Display.ts:1339–1358`) to pass its coordinate explicitly. Fixes the bug as a
   side effect.

3. **Wire remote changes in.** After `storageContext.init()`, subscribe: `onChange(c => paintCell(...))` for
   letters, and tick the clue checkbox for `solved` changes. `paintCell` is now callable from a network event
   exactly as from a keystroke.

   This is also the hook the reveal policy plugs into (Phase 4): `paintCell` consults the policy and either
   paints the remote letter or holds it back with an affordance. Because the policy lives *only* here — and
   the room state stays authoritative regardless — "advance on my own" costs one branch in one function, not
   a second state layer.

**Do not use `rect` fill for other players' cursors.** `highlightDefinitionByCoordinate` (`Display.ts:1163`)
paints selection by directly setting `fill` on rects and clears via
`querySelectorAll("rect.highlighted") → fill=white`. A presence overlay must be a **separate `<g>` layer of
stroked outline rects + name chips**, appended last in `createPuzzleSvg` (`Display.ts:928`) so it stacks above
and can't be wiped.

### New files

```
src/config.ts                     // Firebase web config + EXTERNAL_STORAGE_BASE_URL
                                  //   (app.ts:33 already has a TODO asking for exactly this)
src/state/ICrosswordState.ts      // the interface + change-event types
src/state/LocalStorageContext.ts  // today's class, moved
src/state/RoomStorageContext.ts   // RTDB-backed; same interface
src/multiplayer/firebase.ts       // lazy dynamic import() of the SDK
src/multiplayer/room.ts           // create/join/leave, id generation, URL building
src/multiplayer/presence.ts       // presence writes, heartbeat, onDisconnect
src/render/PresenceLayer.ts       // overlay <g>: outline rects + name chips
src/ui/RoomBar.ts                 // "solve together" button, player list, share modal
```

**Untouched:** `createClues`, context menus, check-solution, `showSingle`, `showIndex`, the `?state=` share
flow, `Utils.ts`, SVG geometry, CSS, `index.json`, the crossword JSON format, and the entire
`CrosswordDigitization` repo.

### URL scheme

`?id=<crosswordId>&room=<roomId>` — `app.ts` gains a `room=` match alongside the existing `id=`/`single=`/
`state=` regexes (`app.ts:42–45`). `?state=` and `?room=` are mutually exclusive; if both appear, `room` wins
and the state param is ignored. `?single=` is unaffected.

### Bundle size

Firebase modular v10 (`app` + `database` + `auth`, tree-shaken) is ~70–90 KB gzipped — real weight for a site
whose current dependency list is just Bootstrap. Load it with a **dynamic `import()`**, triggered only when
`?room=` is present or the user clicks "solve together". Single-player page weight stays exactly as it is
today. Webpack already emits a separate `runtime.bundle.js` (`index.html:15`), so code splitting is already
configured.

---

## Deployment impact

| Piece | Change |
|---|---|
| Solver site | **None.** Still GitHub Pages; the existing `github-actions-bundle.yml` Action rebuilds `dist/` unchanged |
| Firebase project | Firebase console → *Add project* → **select the existing GCP project**. No new billing account |
| Auth | Enable the Anonymous provider (one toggle). Add the GitHub Pages domain to Authorized Domains |
| Rules | New `firebase.json` + `database.rules.json` at repo root → `npx firebase deploy --only database`. Optionally a small Action on changes to that file |
| Web config | Firebase web config (`apiKey` etc.) is **public by design** — commit it in `src/config.ts` |
| Cloud Run / `upload_crossword` / GCS bucket | **Untouched** |
| Room TTL | Not needed for v1 (a room is a few KB against a 1 GB free tier). Later: Cloud Scheduler + a scheduled function pruning `lastActiveAt` older than 30 days |

---

## Delivery order

- ~~**Phase −1 — characterization tests first.**~~ **Done.** 69 Playwright tests in `tests/`, green and
  non-flaky across repeat runs. See `tests/README.md`. Original scoping below.
- ~~**Phase 0a — solutions as an optional capability.**~~ **Done — and it was smaller than described here.**
  Investigation showed the degradation was *already* correct: `attachContextMenu`, `setupCheckSolution` and
  `randomSingle` each already gated on the field they needed, so there was no broken behaviour to fix. What
  shipped instead is `src/puzzle-capabilities.ts`: the three scattered `typeof … === 'undefined'` checks became
  three named type guards (`hasClueSolutions` / `hasSolutionGrid` / `canCheckWholeSolution`). Corpus audit
  behind that split: 603 puzzles have all three fields, 3 have none (144, 478, 610), and 2 have
  `sol_grid`+`sol_hash` but no `solutions` (353, 477) — so they are genuinely independent capabilities, not
  one flag.
- ~~**Phase 0b — state refactor, zero features.**~~ **Done.** `src/types.ts`, `src/state/ICrosswordState.ts`,
  `src/state/LocalStorageContext.ts`; `setGridText` split into `renderLetter` / `paintCell` / `applyLetter`
  with explicit coordinates; `handleRemoteChange` subscribed as the multiplayer seam. `Display.ts` 1475 → 1298
  lines. All 69 characterization tests still pass, unchanged — which is the whole point of having written them
  first.

  **Known gap:** `handleRemoteChange` has no test, because nothing can currently produce a change with
  `origin: 'remote'` — `LocalStorageContext` only ever reports the player's own edits. Phase 2's *first* task
  is a two-browser test that drives it. Until then the seam is structurally in place but unexercised.

<details>
<summary>Original Phase −1 / 0 scoping (kept for reference)</summary>

- **Phase −1 — characterization tests first.** The repo has no tests
  (`"test": "echo \"Error: no test specified\" && exit 1"`). Before touching anything, add Playwright and pin
  down *current* single-player behaviour: load a puzzle, click a cell, type a word, check direction swap on
  re-click, backspace/delete, reload and confirm `localStorage` restored the grid, mark a clue solved, the
  `?state=` share round-trip, `?single=`, and the index page. These are **characterization** tests — they
  assert what the code does today, not what it should do. They're what turns "Phase 0 is behaviour-preserving"
  from a hope into a claim, and they keep paying out for every later phase.
- **Phase 0a — solutions as an optional capability.** Small, independent, no multiplayer. Digitized crosswords
  have no `solutions`/`sol_grid`, so gate the solution tab, check-clue and reveal-clue on their presence
  instead of half-failing. Good warm-up that exercises the new test harness. See *The solutions gap* below.
- **Phase 0b — state refactor, zero features.** Extract `LocalStorageContext`, define `ICrosswordState` +
  `onChange`, split `setGridText` → `paintCell`/`applyLetter`. Single-player behaviour is byte-identical —
  proven by Phase −1. This is the riskiest change and it ships independently verifiable.

</details>

- **Phase 1 — infra.** Firebase on the existing GCP project, anon auth, rules, `firebase.json`, `src/config.ts`.
  No UI yet.
- **Phase 2 — letter sync.** `RoomStorageContext`, `?room=` routing, "solve together" button, share modal.
  Writes the full schema (including the `notes/` subtree and its rules) even though notes have no UI yet, so
  nothing needs migrating later. **This is the first real slice:** two browsers, same room link, one types,
  both see it.
- **Phase 3 — presence.** Overlay layer, per-player colours, name chips, live player list.
- **Phase 4 — reveal policy.** The `live`/`onDemand` toggle, the held-back-letter affordance, per-clue
  "another player has filled this" badges, reveal-clue / reveal-one-letter actions, and contested-cell
  flagging. Deliberately *after* presence: it is much easier to reason about — and to demo — once you can see
  who else is in the room.
- **Phase 5 — scratchpad notes.** Per-clue shared text notes on the schema reserved in Phase 2.
- **Phase 6 — polish.** Solved-marker sync, the join-with-solo-progress merge banner, a connection-status
  indicator, room cleanup.
- **Phase 7 — mobile clue view.** Swipeable single-definition view built out from `showSingle()`, hosting the
  scratchpad panel.

---

## Verification

**Local dev without touching production:**
```
npx firebase emulators:start --only database,auth
npm start                          # webpack-dev-server, live reload
```
Point `src/config.ts` at the emulator when `location.hostname === "localhost"`.

**The core manual test** (Phase 2 acceptance): open the same `?id=...&room=...` link in two browser windows
(one in a private window so it gets a distinct anonymous uid). Type in window A → the letter appears in
window B within ~200ms. Type in *different* cells simultaneously → **neither is lost** (this is the test that
would fail with the naive row-string sync). Type in the *same* cell simultaneously → last write wins, both
windows converge to the same letter. Close window B → its cursor disappears from A within a few seconds.
Kill the network in A, type three letters, restore → all three land in B.

**Automated:** the repo currently has `"test": "echo \"Error: no test specified\" && exit 1"`. Add Playwright —
`CrosswordDigitization` already uses it, so it's the same tooling and the same muscle memory. A two-browser-
context spec drives the manual test above against the emulator. Add `@firebase/rules-unit-testing` for the
security rules (a player cannot write `by` as someone else's uid; a player cannot write another player's
presence node).

---

---

## The solutions gap

Upstream crosswords ship with an answer key (`solutions` + `sol_grid`), which powers the solution tab,
check-clue and reveal-clue. `export-stage.ts` emits only `{author, dimensions, grid, definitions, id}`, so
**digitized crosswords have no key** and those features are inert or half-broken for them.

This is orthogonal to the state refactor — it's a *capability* problem, not a state problem, so Phase 0b
doesn't make it easier. It is, however, smaller and independently shippable, hence Phase 0a. The fix is to
treat the key as optional throughout: a `hasSolutions(puzzleInfo)` predicate gating the solution tab
(`index.html:87`), the context-menu actions (`Display.ts:1032`) and `setupCheckSolution`
(`Display.ts:550`), rather than the current `typeof(puzzleInfo.solutions) == "undefined" → return` early-outs
that silently do nothing.

**The load-bearing insight for multiplayer:** most of the desired hint UX does *not* need an answer key.
"Reveal a letter" can be **peer-sourced** — surface a letter another player has already filled in. In a
shared room the other players are the hint source. Only *"is my answer objectively correct"* and *"reveal the
true answer"* genuinely require the key. So the solutions gap constrains far less of the multiplayer roadmap
than it first appears.

---

## Reveal policy — "advance on my own"

**Chosen model: shared truth, private view.** There is exactly one authoritative room state and every player
always writes to it. The toggle controls only what the local screen renders. No second state layer, no merge
logic, no conflict UI.

Concretely, `paintCell(coord, letter)` gains a policy check. Two modes, a local `localStorage` preference:

- **`live`** (default) — remote letters paint immediately. Today's assumed behaviour.
- **`onDemand`** — remote letters are held back. The room state still updates underneath; the cell renders
  empty but carries a subtle *"something is here"* affordance (a corner tick, not a fill — remember
  `highlightDefinitionByCoordinate` owns `rect` fill). The clue list shows a per-clue badge: *"another player
  has filled this"*. From there the player chooses: **reveal the clue**, **reveal one letter** (a hint), or
  ignore it and keep solving.

This is where the peer-sourced hint from *The solutions gap* lands: **"reveal one letter" reads from room
state, not from an answer key**, so it works on digitized crosswords that have no key at all.

### The edge case this creates

In `onDemand` mode you can type into a cell that already holds a *different, unrevealed* remote letter. Plain
LWW would silently destroy another player's work — and neither of you would ever know.

**Handling:** compare before writing. If the incoming local letter differs from an unrevealed remote letter,
the write still proceeds (LWW stands, your input is never blocked), but the cell is flagged **contested** and
shows an indicator. You then find out that you and someone else disagree about that square — which is
precisely the information worth surfacing. Cheap to implement (one comparison in `applyLetter`) and it turns a
silent data-loss bug into a feature.

`live` mode is unaffected: you can see the letter you're overwriting, so there is nothing to warn about.

---

## Scratchpad notes

Shipping in v1, **shared and synced** — any room member can read every note; only the author can edit or
delete their own (enforced in the rules above, not in UI). Per-clue, keyed `"<direction>_<clueId>"`.

The `kind: "text"` discriminator is written from day one so **voice notes need no migration later** — they
become `{ kind: "voice", audioUrl, durationMs }` with the blob in object storage and only the reference in
RTDB. When that lands, the natural reuse is the existing GCS bucket + `upload_crossword` Cloud Function
pattern, which already solves "browser POSTs content, gets back a public URL". Worth a `MediaRecorder` spike
on iOS/Safari before committing to it — the audio format story there is genuinely fiddly.

## Mobile clue view (post-multiplayer)

Deferred until after multiplayer ships, but noted here because it is the natural **host** for the notes panel,
so its information architecture is worth sketching before the notes UI is finalized.

Existing foothold: `showSingle()` (`Display.ts:1397` area, reached via `?single=<id>.<dir>.<n>`) already
renders one definition standalone. Extending it into a swipeable per-clue view — one definition at a time,
its cells pre-filled with letters already known from crossing answers, plus that clue's scratchpad and (later)
voice notes — reuses `nextCoordinate`/`prevCoordinate` and the existing clue metadata rather than adding a new
traversal model.

---

## Notes

- **Fork divergence.** This refactor splits `Display.ts`, which effectively ends practical merging from
  upstream. That's a reasonable trade for owning the code, but it's a one-way door. The MIT licence requires
  keeping the copyright notice — keep the *"based on Dvd848/cryptic-crossword"* credit in the about modal
  (`index.html:142`).
- Work lands on branch `claude/crossword-solver-architecture-2mqbuq` in `tomer-gavish/cryptic-crossword`.
