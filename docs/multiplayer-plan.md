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

**Decisions:**
- Stay on GCP → Firebase RTDB (see *Why not Firestore* below).
- **Anonymous auth + nickname now, upgradeable to real accounts later** — see *Identity* below.
- **One shared grid**, Google-Docs style, with visible cursors. Letters record who typed them (`by`), which
  costs nothing now and enables per-player attribution later.
- **Rooms are created in the solver**, on demand, via a "solve together" button. `CrosswordDigitization` stays
  decoupled — its job still ends at uploading JSON to the bucket.

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
```

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
  "meta": { ".write": "auth != null && (!data.exists() || newData.child('createdBy').val() === data.child('createdBy').val())" }
}}}}
```

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
- **Phase 1 — infra.** Firebase on the existing GCP project, anon auth, rules, `firebase.json`, `src/config.ts`.
  No UI yet.
- **Phase 2 — letter sync.** `RoomStorageContext`, `?room=` routing, "solve together" button, share modal.
  **This is the first real slice:** two browsers, same room link, one types, both see it.
- **Phase 3 — presence.** Overlay layer, per-player colours, name chips, live player list.
- **Phase 4 — polish.** Solved-marker sync, the join-with-solo-progress merge banner, a connection-status
  indicator, room cleanup.

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

## UX decisions: what must be settled now vs later

The rule: **schema-affecting UX now, pixel UX later.** Anything that becomes synced state is expensive to
retrofit (and worse to migrate in live rooms); anything purely visual is cheap to change.

**Must be settled before Phase 2** (they change the schema or the render architecture):

1. **Typing visibility.** "Advance on my own, reveal others on demand" is the single most architecturally
   significant idea on the list — it breaks the assumption that the local grid mirrors room state. It forces
   two layers: `roomState` (truth) and `myView` (what I've chosen to see), with `paintCell` consulting a
   reveal policy. The unresolved sub-question: *do my letters still flow into the room while I'm not seeing
   yours?* Yes → asymmetric visibility. No → genuinely private grids with explicit merge, which is a
   different product from "one shared grid".
2. **Per-clue scratchpad / notes / discussion.** Synced state → needs a schema slot now:
   `rooms/{id}/clues/{across_12}/notes/{noteId} = {by, at, text}`. Cheap to reserve, expensive to bolt on.
3. **Voice notes.** Audio is a *blob*, not database state — it belongs in object storage with only a
   reference in RTDB. Natural reuse: the existing GCS bucket + `upload_crossword` Cloud Function pattern
   already solves "browser POSTs content, gets back a public URL". Recording is `MediaRecorder`; Safari/iOS
   has real format quirks worth prototyping early.
4. **Private vs shared notes.** Whether a note is visible to the room or only to its author is a rules-level
   decision, not a UI toggle — it has to be in the security rules from the start.

**Can wait for wireframes:** the mobile clue view's actual layout, colour/avatar treatment for players, the
share modal's copy, animation and transitions.

**The mobile "clue view"** is a strong idea with an existing foothold: `showSingle()` (`Display.ts`, reached
via `?single=<id>.<dir>.<n>`) already renders a single definition standalone. Extending it into a swipeable
per-clue view — one definition, its cells pre-filled with letters already known from crossing answers, plus
the notes/voice/discussion panel for that clue — reuses `nextCoordinate`/`prevCoordinate` and the existing
clue metadata. Note it is *not* a multiplayer feature but it is the natural **host** for the notes and
discussion panels, so its information architecture should be sketched alongside them even if the visuals land
later.

---

## Notes

- **Fork divergence.** This refactor splits `Display.ts`, which effectively ends practical merging from
  upstream. That's a reasonable trade for owning the code, but it's a one-way door. The MIT licence requires
  keeping the copyright notice — keep the *"based on Dvd848/cryptic-crossword"* credit in the about modal
  (`index.html:142`).
- Work lands on branch `claude/crossword-solver-architecture-2mqbuq` in `tomer-gavish/cryptic-crossword`.
