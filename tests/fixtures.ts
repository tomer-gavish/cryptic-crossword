/**
 * Shared fixtures and DOM addressing helpers for the characterization suite.
 *
 * These tests pin down what the solver does *today*, before the multiplayer
 * refactor. They assert observed behaviour, not desired behaviour — where the
 * current behaviour is arguably wrong, the test says so in a comment rather
 * than asserting the fix. That is the point: the refactor must not change any
 * of this, and any change that does show up here is a decision, not an
 * accident.
 */
import { test as base, expect, type Browser, type CDPSession, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

const BOOTSTRAP_CSS = path.join(
    __dirname,
    '..',
    'node_modules',
    'bootstrap',
    'dist',
    'css',
    'bootstrap.rtl.min.css',
);

/** A puzzle that ships with an answer key — the upstream norm (603 of 608). */
export const PUZZLE_WITH_SOLUTIONS = '1';
/** A puzzle with no `solutions`/`sol_grid` — 5 exist upstream, and every
 *  digitized crossword looks like this. */
export const PUZZLE_WITHOUT_SOLUTIONS = '610';

/**
 * The page pulls Bootstrap's stylesheet from jsdelivr and analytics from
 * Google. Neither is reachable offline, and a missing Bootstrap stylesheet
 * silently breaks every visibility assertion (modals and tab panes are
 * display-driven by Bootstrap CSS). Serve the stylesheet from the copy npm
 * already installed, and drop analytics entirely — that makes the suite
 * deterministic and network-free without touching production code.
 *
 * Exported because multiplayer tests open a second player's page by hand and
 * it needs the same treatment.
 */
export async function installOfflineRoutes(page: Page): Promise<void> {
    // Bootstrap is pinned to the exact version index.html's SRI hash was
    // computed for, and npm ships the same bytes the CDN does, so the local
    // substitute passes the integrity check unmodified. `bootstrap-css.spec.ts`
    // guards that: if the versions ever drift apart again the browser silently
    // blocks the stylesheet, and every visibility assertion here starts
    // testing an unstyled page without saying so.
    await page.route('**/cdn.jsdelivr.net/**bootstrap**', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'text/css',
            body: await fs.promises.readFile(BOOTSTRAP_CSS, 'utf8'),
        });
    });
    // Analytics is disabled in index.html, so this should never fire. Kept as
    // a backstop: if a tag is ever reintroduced, tests must still not report
    // page views to anyone.
    await page.route('**/googletagmanager.com/**', (route) => route.abort());
}

export const test = base.extend<{ page: Page }>({
    page: async ({ page }, use) => {
        await installOfflineRoutes(page);
        await use(page);
    },
});

export { expect };

/** Open a crossword by id and wait for the grid to be live. */
export async function openCrossword(page: Page, id: string): Promise<void> {
    await page.goto(`/?id=${id}`);
    await expect(page.locator('#wrapper')).toBeVisible();
    await expect(page.locator('#crossword svg')).toBeVisible();
}

/**
 * Open a crossword as part of a shared room. Waits for the grid, which only
 * appears after anonymous sign-in and the first room snapshot have completed.
 */
export async function openRoom(page: Page, id: string, roomId: string): Promise<void> {
    await page.goto(`/?id=${id}&room=${roomId}`);
    await expect(page.locator('#wrapper')).toBeVisible();
    await expect(page.locator('#crossword svg')).toBeVisible();
}

/**
 * A fresh room id per test. Rooms are never torn down, so isolation comes from
 * never reusing an id rather than from cleaning up — which also keeps tests
 * safe to run in parallel.
 */
export function uniqueRoomId(): string {
    return `test${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * A second player: a separate browser context, so they get their own anonymous
 * uid. That matters — telling local edits from remote ones depends on the two
 * players having different uids.
 */
export async function newPlayerPage(browser: Browser): Promise<{ page: Page; close: () => Promise<void> }> {
    const context = await browser.newContext({ locale: 'he-IL' });
    const page = await context.newPage();
    await installOfflineRoutes(page);
    return { page, close: () => context.close() };
}

/**
 * Cells are `<g>` elements appended in row-major order, one per grid square,
 * with no ids of their own — so index arithmetic is the only way in.
 */
export function cellGroup(page: Page, row: number, col: number, columns: number) {
    return page.locator('#crossword svg > g').nth(row * columns + col);
}

export function cellRect(page: Page, row: number, col: number, columns: number) {
    return cellGroup(page, row, col, columns).locator('rect');
}

/** The letter a player has typed into a square (distinct from the clue number). */
export function cellLetter(page: Page, row: number, col: number, columns: number) {
    return cellGroup(page, row, col, columns).locator('text.letter_elem_text');
}

export async function letterAt(
    page: Page,
    row: number,
    col: number,
    columns: number,
): Promise<string> {
    return (await cellLetter(page, row, col, columns).textContent()) ?? '';
}

/**
 * Click a square. Clicking is what focuses the hidden `dummy_input` that the
 * keyup handler filters on, so typing only works after a click.
 *
 * Clicks by position rather than on the `rect` locator: once a square holds a
 * letter, its `<text>` element covers the rect and intercepts pointer events.
 * Both carry the same handler, so a real user is unaffected — but a
 * `rect.click()` would fail the actionability check. Hitting the centre point
 * lands on whichever element is topmost, exactly as a user does.
 */
export async function clickCell(
    page: Page,
    row: number,
    col: number,
    columns: number,
): Promise<void> {
    const rect = cellRect(page, row, col, columns);
    // `page.mouse` works in viewport coordinates and does not auto-scroll the
    // way `locator.click()` does, so the square has to be brought into view
    // first — otherwise a test that scrolled earlier (e.g. by ticking a clue
    // checkbox) would click empty space and silently select nothing.
    await rect.scrollIntoViewIfNeeded();
    const box = await rect.boundingBox();
    if (!box) {
        throw new Error(`Square (${row},${col}) has no bounding box — is it rendered?`);
    }
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

/** The hidden input that actually receives keystrokes for a square. */
export function dummyInput(page: Page, row: number, col: number) {
    return page.locator(`#dummy_input_r${row}_c${col}`);
}

const cdpSessions = new WeakMap<Page, Promise<CDPSession>>();

/**
 * Type Hebrew into the grid.
 *
 * `keyboard.type()` cannot be used here: for characters outside the active
 * keyboard layout Playwright falls back to `Input.insertText`, which fires an
 * `input` event but no `keyup` — and the solver listens for `keyup`. So Hebrew
 * silently does nothing while latin letters work, which is a trap worth
 * naming. `keyboard.press()` is no good either; it rejects unknown keys.
 *
 * Driving CDP directly sends real, trusted key events through the browser's
 * input pipeline, exactly as a physical Hebrew keyboard would. Chromium-only,
 * which is all this suite targets.
 */
export async function typeLetters(page: Page, text: string): Promise<void> {
    let session = cdpSessions.get(page);
    if (!session) {
        session = page.context().newCDPSession(page);
        cdpSessions.set(page, session);
    }
    const cdp = await session;

    for (const ch of text) {
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, text: ch });
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch });
    }
}

/** Press a named key (Backspace, Delete, ...) — these map fine via Playwright. */
export async function pressKey(page: Page, key: string): Promise<void> {
    await page.keyboard.press(key);
}

/** Read the raw persisted state blob for a crossword id. */
export async function readStoredState(page: Page, crosswordId: string) {
    return page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key) ?? 'null'),
        `crossword_${crosswordId}`,
    );
}

export function clueCheckbox(page: Page, clueId: number, direction: 'across' | 'down') {
    return page.locator(`#clue_checkbox_${clueId}_${direction}`);
}
