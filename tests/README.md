# Characterization tests

These tests pin down what the solver does **today**, before the multiplayer
refactor described in [`docs/multiplayer-plan.md`](../docs/multiplayer-plan.md).

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
runs offline. A missing Bootstrap stylesheet silently breaks visibility
assertions, because modals and tab panes are display-driven by its CSS.

**Chromium only.** The CDP dependency above means these tests do not run on
Firefox or WebKit as written.

**Pre-installed browsers.** Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to point at an
existing Chromium binary in sandboxes or CI images where `npx playwright install`
is unavailable and the bundled browser version does not match. Leave it unset on
a normal dev machine.
