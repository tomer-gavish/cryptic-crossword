# Tests

Two suites live here:

- **Characterization** (`grid-interaction`, `storage`, `clues`, `share-state`,
  `solutions`, `navigation`) — what the solver did before the multiplayer work
  began, so that refactors have to prove themselves.
- **Multiplayer** (`multiplayer.spec.ts`) — two browsers sharing one grid,
  driven against the Firebase emulator.

The characterization tests pin down what the solver does **today**, as described
in [`docs/multiplayer-plan.md`](../docs/multiplayer-plan.md).

They assert *observed* behaviour, not *desired* behaviour. Where the current
behaviour is arguably wrong, the test records it with a comment explaining why,
rather than asserting the fix. That is deliberate: the refactor extracts
`StorageContext` behind an interface, splits `setGridText` into a render half
and a persist half, and adds a room-backed second implementation. None of that
should change any behaviour a player can observe — and if it does, it should
show up here as a decision to make, not a regression to discover later.

## Running them

```
npm test               # builds the bundle, then runs the suite
npm run test:headed    # watch it drive a real browser
npm run test:ui        # Playwright's interactive runner
npm run test:report    # open the HTML report from the last run
```

The suite runs against the **production bundle in `dist/`**, served as plain
static files — the same artifact GitHub Pages serves. `npm test` rebuilds first;
if you run `npx playwright test` directly after editing `src/`, rebuild yourself
or you will be testing stale code.

## What is covered

| Spec | Pins down |
|---|---|
| `grid-interaction.spec.ts` | Selecting squares, highlight colours, direction swapping, typing, cursor advance, Backspace/Delete, Hebrew final-letter normalization, latin letters rendering red |
| `storage.spec.ts` | The exact `localStorage` format — key scheme, `"?"` for blanks, `solved_clues` bit strings, the `VCN` wipe, dimension-mismatch recovery, legacy-format migration |
| `clues.spec.ts` | Clue list rendering, selection from clue text, the current-definition toolbar, solved marks across both directions |
| `share-state.spec.ts` | The `?state=` share link: generation, read-only viewing, import/back, corrupt-state fallback |
| `solutions.spec.ts` | How the UI degrades on puzzles with no answer key |
| `navigation.spec.ts` | `?id=<digits>`, `?id=<hex>` (external bucket), `?single=`, index page, and every fallback path |
| `multiplayer.spec.ts` | Two browsers in one room: letters and solved marks replicating, concurrent edits to different squares both surviving, same-square convergence, late joiners catching up, room isolation, and solo play staying on localStorage |

## Fixtures

Two puzzles are used deliberately:

- **`1`** — has `solutions`, `sol_grid` and `sol_hash`, like 603 of the 608
  bundled crosswords.
- **`610`** — has none of them. Five bundled crosswords are like this
  (144, 353, 477, 478, 610), and so is **every digitized crossword**, since
  the exporter in `CrosswordDigitization` emits only
  `{author, dimensions, grid, definitions, id}`.

`navigation.spec.ts` also stubs the GCS bucket to exercise the external-crossword
route without network access.

## Notes for anyone extending these

**Typing Hebrew needs CDP.** `page.keyboard.type()` cannot be used: for
characters outside the active keyboard layout Playwright falls back to
`Input.insertText`, which fires an `input` event but no `keyup` — and the solver
listens for `keyup`. Hebrew therefore does nothing while latin letters work,
which is a trap worth knowing about. `keyboard.press()` is no good either; it
rejects unknown keys. Use the `typeLetters()` helper, which drives
`Input.dispatchKeyEvent` over CDP and produces real trusted events.

**Clicking squares goes through `clickCell()`.** Once a square holds a letter,
its `<text>` element covers the `rect` and intercepts pointer events, so
`rect.click()` fails its actionability check even though a real user is
unaffected (both carry the same handler). `clickCell()` scrolls the square into
view and clicks its centre point, hitting whichever element is topmost.

**No network.** Bootstrap's stylesheet is served from `node_modules` via request
interception and Google Analytics is aborted, so the suite is deterministic and
runs offline.

That substitution only works because `package.json` pins Bootstrap to the exact
version `index.html`'s SRI hash was computed for (**5.2.3**, not `^5.2.3`), and
npm ships byte-identical files to the CDN — so the local copy passes the
integrity check untouched.

Keep that pin exact. Under a caret range npm resolves to 5.3.x, the hash fails,
and the browser blocks the stylesheet **silently**: the page still renders, the
suite still passes, and every visibility assertion quietly starts testing an
unstyled page. `bootstrap-css.spec.ts` exists to catch precisely that.

**Chromium only.** The CDP dependency above means these tests do not run on
Firefox or WebKit as written.

**Local Network Access.** The launch args disable
`LocalNetworkAccessChecks`. Recent Chromium treats a request from the page to a
*different loopback port* — which is exactly how the multiplayer specs reach the
Firebase emulator — as a local-network request and blocks it. It does so
silently: the request never completes, with no error and no failed-request
event, while same-origin requests keep working so the app looks healthy.

**Pre-installed browsers.** Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to point at an
existing Chromium binary in sandboxes or CI images where `npx playwright install`
is unavailable and the bundled browser version does not match. Leave it unset on
a normal dev machine.

## The Firebase emulator

`playwright.config.ts` starts `firebase emulators:start --only database,auth`
alongside the static server; nothing needs starting by hand.

It requires **JDK 21 or newer**: the database emulator is a Java process, and
firebase-tools refuses to start on anything older with "no longer supports Java
version before 21". GitHub's runners default to an older JDK, so the workflow
selects 21 explicitly.

The project id is `demo-crossword`. The `demo-` prefix makes the Firebase SDKs
refuse to contact any real backend, so a misconfigured test cannot reach
production data.

Rules come from the real `database.rules.json`, so the emulator enforces exactly
what deploys. Note the loader wants **strict JSON** — `//` comments are rejected,
and the resulting error names the rules file while quoting content that isn't in
it, which is misleading.

If the CLI reports `Unable to parse JSON` on a rules file that is plainly valid,
the cause is usually an HTTP proxy: the CLI routes its own request to the
emulator through it and then tries to parse the proxy's error page. The config
strips proxy variables from the emulator's environment for this reason.

Each test mints a unique room id, so tests are isolated without teardown and
safe in parallel.

### If every multiplayer test suddenly fails

Suspect an **orphaned database emulator**. The CLI runs the database as a Java
child and only stops it during its own clean shutdown; if the CLI is killed
first, that Java process survives and keeps holding port 9000. The next run's
`reuseExistingServer` probe — which only checks the database — then sees a
healthy emulator, skips starting one, and never brings **auth** up. Anonymous
sign-in hangs and every test in `multiplayer.spec.ts` times out, while the
database looks perfectly fine.

`gracefulShutdown` in `playwright.config.ts` gives the CLI time to stop its
child, which prevents this. To confirm it has happened anyway:

```
curl -sS -o /dev/null -w '%{http_code}\n' "http://127.0.0.1:9000/.json?ns=demo-crossword"   # 200
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:9099/                            # 000
pgrep -af firebase-database-emulator
```

A live Java process with no `firebase emulators:start` parent is the orphan;
kill it and rerun.
