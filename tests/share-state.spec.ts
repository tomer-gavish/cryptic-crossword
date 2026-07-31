/**
 * Characterization: the `?state=` share link.
 *
 * This matters disproportionately for the multiplayer work: it is the codebase's
 * *existing* second state provenance, and the read-only mode it implements is
 * the seam multiplayer will sit beside. `?state=` and `?room=` will have to
 * coexist, so what it does today needs pinning down.
 */
import {
    test,
    expect,
    openCrossword,
    clickCell,
    letterAt,
    typeLetters,
    readStoredState,
    dummyInput,
    clueCheckbox,
    PUZZLE_WITH_SOLUTIONS,
} from './fixtures';

const COLS = 14;

/** Solve a few squares, then read the share URL out of the share modal. */
async function buildShareLink(page: import('@playwright/test').Page): Promise<string> {
    await clickCell(page, 0, 13, COLS);
    await typeLetters(page, 'קיקלופ');

    await page.locator('#share_solution_wrapper button').click();
    const shareLink = page.locator('#share_link');
    await expect(shareLink).toBeVisible();
    await expect.poll(() => shareLink.inputValue()).not.toBe('');
    return shareLink.inputValue();
}

test('the share modal produces a link carrying id and compressed state', async ({ page }) => {
    await openCrossword(page, PUZZLE_WITH_SOLUTIONS);
    const link = await buildShareLink(page);

    const url = new URL(link);
    expect(url.searchParams.get('id')).toBe(PUZZLE_WITH_SOLUTIONS);
    expect(url.searchParams.get('state')).toBeTruthy();
    // gzip+base64, so it should not look like readable JSON.
    expect(url.searchParams.get('state')).not.toContain('input');
});

test('opening a share link restores the shared letters', async ({ page, context }) => {
    await openCrossword(page, PUZZLE_WITH_SOLUTIONS);
    const link = await buildShareLink(page);

    // A different browser context — nobody else's localStorage involved.
    const viewer = await context.browser()!.newContext();
    const viewerPage = await viewer.newPage();
    await viewerPage.goto(link);
    await expect(viewerPage.locator('#crossword svg')).toBeVisible();

    const shown = [];
    for (const col of [13, 12, 11, 10, 9, 8]) {
        shown.push(
            (await viewerPage
                .locator('#crossword svg > g')
                .nth(0 * COLS + col)
                .locator('text.letter_elem_text')
                .textContent()) ?? '',
        );
    }
    expect(shown.join('')).toBe('קיקלופ');
    await viewer.close();
});

test('share mode is read-only: no typing, no clue checkboxes, no share button', async ({
    page,
}) => {
    await openCrossword(page, PUZZLE_WITH_SOLUTIONS);
    const link = await buildShareLink(page);

    await page.evaluate(() => localStorage.clear());
    await page.goto(link);
    await expect(page.locator('#crossword svg')).toBeVisible();

    // The share banner replaces the share button.
    await expect(page.locator('#share_actions')).toBeVisible();
    await expect(page.locator('#share_solution_wrapper')).not.toBeVisible();

    // Clicking a square does not select it, so nothing can be typed.
    await clickCell(page, 0, 13, COLS);
    await expect(dummyInput(page, 0, 13)).not.toBeFocused();
    await typeLetters(page, 'ז');
    expect(await letterAt(page, 0, 13, COLS)).toBe('ק');

    // Clue checkboxes are omitted entirely in this mode.
    await expect(page.locator('#clues_horizontal input.clue_checkbox')).toHaveCount(0);
});

test('share mode does not write to localStorage', async ({ page }) => {
    await openCrossword(page, PUZZLE_WITH_SOLUTIONS);
    const link = await buildShareLink(page);

    await page.evaluate(() => localStorage.clear());
    await page.goto(link);
    await expect(page.locator('#crossword svg')).toBeVisible();

    expect(await readStoredState(page, PUZZLE_WITH_SOLUTIONS)).toBeNull();
});

test('"import" adopts the shared solution and backs up the previous one', async ({ page }) => {
    await openCrossword(page, PUZZLE_WITH_SOLUTIONS);
    const link = await buildShareLink(page);

    // Start a different local solution, then view the shared one and import it.
    await page.goto(`/?id=${PUZZLE_WITH_SOLUTIONS}`);
    await expect(page.locator('#crossword svg')).toBeVisible();
    await clickCell(page, 0, 13, COLS);
    await typeLetters(page, 'זזז');

    await page.goto(link);
    await expect(page.locator('#crossword svg')).toBeVisible();
    await page.locator('#share_import').click();
    await expect(page.locator('#crossword svg')).toBeVisible();

    // The shared letters are now the player's own saved state...
    const state = await readStoredState(page, PUZZLE_WITH_SOLUTIONS);
    expect(state.input[0][13]).toBe('ק');
    expect(state.input[0][12]).toBe('י');

    // ...and the overwritten solution is preserved under a backup key.
    const backup = await page.evaluate(() =>
        JSON.parse(localStorage.getItem('crossword_1_backup') ?? 'null'),
    );
    expect(backup.input[0][13]).toBe('ז');
});

test('"back" returns to the player\'s own solution, discarding the shared view', async ({
    page,
}) => {
    await openCrossword(page, PUZZLE_WITH_SOLUTIONS);
    const link = await buildShareLink(page);

    await page.goto(`/?id=${PUZZLE_WITH_SOLUTIONS}`);
    await expect(page.locator('#crossword svg')).toBeVisible();
    await clickCell(page, 0, 13, COLS);
    await typeLetters(page, 'זזז');

    await page.goto(link);
    await expect(page.locator('#crossword svg')).toBeVisible();
    await page.locator('#share_back').click();
    await expect(page.locator('#crossword svg')).toBeVisible();

    expect(await letterAt(page, 0, 13, COLS)).toBe('ז');
    await expect(page.locator('#share_actions')).not.toBeVisible();
});

test('a corrupt state parameter falls back to the local solution and warns', async ({ page }) => {
    await openCrossword(page, PUZZLE_WITH_SOLUTIONS);
    await clickCell(page, 0, 13, COLS);
    await typeLetters(page, 'ז');

    await page.goto(`/?id=${PUZZLE_WITH_SOLUTIONS}&state=not-valid-gzip`);
    await expect(page.locator('#crossword svg')).toBeVisible();

    await expect(page.locator('#share_error')).toBeVisible();
    // Falls back to whatever was saved locally, and stays editable.
    expect(await letterAt(page, 0, 13, COLS)).toBe('ז');
    await expect(page.locator('#clues_horizontal input.clue_checkbox').first()).toBeAttached();
});

test('shared solved-clue marks travel with the link', async ({ page, context }) => {
    await openCrossword(page, PUZZLE_WITH_SOLUTIONS);
    await clueCheckbox(page, 8, 'across').check();
    const link = await buildShareLink(page);

    const viewer = await context.browser()!.newContext();
    const viewerPage = await viewer.newPage();
    await viewerPage.goto(link);
    await expect(viewerPage.locator('#crossword svg')).toBeVisible();

    // Checkboxes are hidden in share mode, but the "solved" styling still shows.
    await expect(viewerPage.locator('#clues_horizontal dd.solved')).toHaveCount(1);
    await viewer.close();
});
