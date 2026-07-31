/**
 * Characterization: the localStorage persistence format.
 *
 * This is the contract the multiplayer refactor must not break. `StorageContext`
 * is about to be extracted behind an interface and given a second, room-backed
 * implementation; the shape asserted here is what the *local* implementation
 * must keep producing, and what already-saved browsers will keep loading.
 */
import {
    test,
    expect,
    openCrossword,
    clickCell,
    letterAt,
    typeLetters,
    readStoredState,
    clueCheckbox,
    PUZZLE_WITH_SOLUTIONS,
} from './fixtures';

const COLS = 14;
const ROWS = 14;
// num_clues_* is `max clue id + 1`, so the "solved" strings are one longer than
// the highest clue number. Puzzle 1 tops out at across-28 and down-26.
const ACROSS_SOLVED_LEN = 29;
const DOWN_SOLVED_LEN = 27;

test('a fresh puzzle persists an empty grid under a predictable key', async ({ page }) => {
    await openCrossword(page, PUZZLE_WITH_SOLUTIONS);
    // Nothing is written until the first edit.
    await clickCell(page, 0, 13, COLS);
    await typeLetters(page, 'ק');

    const state = await readStoredState(page, PUZZLE_WITH_SOLUTIONS);
    expect(state).not.toBeNull();
    expect(Object.keys(state).sort()).toEqual(['input', 'solved_clues', 'version']);
    expect(state.version).toBe('2');
    expect(state.input).toHaveLength(ROWS);
    for (const row of state.input) {
        expect(row).toHaveLength(COLS);
    }
});

test('empty squares are stored as "?" and letters in place', async ({ page }) => {
    await openCrossword(page, PUZZLE_WITH_SOLUTIONS);
    await clickCell(page, 0, 13, COLS);
    await typeLetters(page, 'קיק');

    const state = await readStoredState(page, PUZZLE_WITH_SOLUTIONS);
    // Row 0, RTL: cols 13,12,11 hold the letters; everything else is "?".
    // Blocked squares are stored as "?" too — the grid JSON, not the saved
    // state, is what knows which squares are blocked.
    expect(state.input[0]).toBe('?'.repeat(11) + 'קיק');
    expect(state.input[0][13]).toBe('ק');
    expect(state.input[0][12]).toBe('י');
    expect(state.input[0][11]).toBe('ק');
    expect(state.input[0][10]).toBe('?');
    expect(state.input[1]).toBe('?'.repeat(COLS));
});

test('solved_clues starts as zeroes sized to the highest clue id plus one', async ({ page }) => {
    await openCrossword(page, PUZZLE_WITH_SOLUTIONS);
    await clickCell(page, 0, 13, COLS);
    await typeLetters(page, 'ק');

    const state = await readStoredState(page, PUZZLE_WITH_SOLUTIONS);
    expect(state.solved_clues.across).toBe('0'.repeat(ACROSS_SOLVED_LEN));
    expect(state.solved_clues.down).toBe('0'.repeat(DOWN_SOLVED_LEN));
});

test('marking a clue solved flips the character at index id-1', async ({ page }) => {
    await openCrossword(page, PUZZLE_WITH_SOLUTIONS);
    await clueCheckbox(page, 8, 'across').check();

    const state = await readStoredState(page, PUZZLE_WITH_SOLUTIONS);
    expect(state.solved_clues.across[7]).toBe('1');
    expect(state.solved_clues.across.replace(/0/g, '')).toBe('1');
    // The down axis is untouched.
    expect(state.solved_clues.down).toBe('0'.repeat(DOWN_SOLVED_LEN));
});

test('unmarking a clue flips it back', async ({ page }) => {
    await openCrossword(page, PUZZLE_WITH_SOLUTIONS);
    await clueCheckbox(page, 8, 'across').check();
    await clueCheckbox(page, 8, 'across').uncheck();

    const state = await readStoredState(page, PUZZLE_WITH_SOLUTIONS);
    expect(state.solved_clues.across).toBe('0'.repeat(ACROSS_SOLVED_LEN));
});

test('typed letters survive a reload', async ({ page }) => {
    await openCrossword(page, PUZZLE_WITH_SOLUTIONS);
    await clickCell(page, 0, 13, COLS);
    await typeLetters(page, 'קיקלופ');

    await page.reload();
    await expect(page.locator('#crossword svg')).toBeVisible();

    const restored = [];
    for (const col of [13, 12, 11, 10, 9, 8]) {
        restored.push(await letterAt(page, 0, col, COLS));
    }
    expect(restored.join('')).toBe('קיקלופ');
});

test('solved marks survive a reload and restore the checkbox and styling', async ({ page }) => {
    await openCrossword(page, PUZZLE_WITH_SOLUTIONS);
    await clueCheckbox(page, 8, 'across').check();

    await page.reload();
    await expect(page.locator('#crossword svg')).toBeVisible();

    await expect(clueCheckbox(page, 8, 'across')).toBeChecked();
    await expect(page.locator('#clues_horizontal dd.solved')).toHaveCount(1);
});

test('state is scoped per crossword id', async ({ page }) => {
    await openCrossword(page, PUZZLE_WITH_SOLUTIONS);
    await clickCell(page, 0, 13, COLS);
    await typeLetters(page, 'ק');

    // A different puzzle must not see those letters.
    await openCrossword(page, '2');
    const other = await readStoredState(page, '2');
    expect(other).toBeNull();

    const keys = await page.evaluate(() => Object.keys(localStorage).sort());
    expect(keys).toContain('crossword_1');
    expect(keys).not.toContain('crossword_2');
});

test('a version-counter key guards the whole store', async ({ page }) => {
    await openCrossword(page, PUZZLE_WITH_SOLUTIONS);
    await expect
        .poll(() => page.evaluate(() => localStorage.getItem('VCN')))
        .toBe('1');
});

test('a stale version counter wipes previously saved progress', async ({ page }) => {
    await openCrossword(page, PUZZLE_WITH_SOLUTIONS);
    await clickCell(page, 0, 13, COLS);
    await typeLetters(page, 'ק');

    // Simulate a browser holding state written by an older, incompatible build.
    await page.evaluate(() => localStorage.setItem('VCN', '0'));
    await page.reload();
    await expect(page.locator('#crossword svg')).toBeVisible();

    expect(await letterAt(page, 0, 13, COLS)).toBe('');
    await expect
        .poll(() => page.evaluate(() => localStorage.getItem('VCN')))
        .toBe('1');
});

test('a saved grid whose dimensions no longer match is discarded, not crashed on', async ({
    page,
}) => {
    await openCrossword(page, PUZZLE_WITH_SOLUTIONS);
    await clickCell(page, 0, 13, COLS);
    await typeLetters(page, 'ק');

    await page.evaluate(() => {
        const state = JSON.parse(localStorage.getItem('crossword_1')!);
        state.input = ['??', '??']; // wrong shape entirely
        localStorage.setItem('crossword_1', JSON.stringify(state));
    });
    await page.reload();

    await expect(page.locator('#crossword svg')).toBeVisible();
    expect(await letterAt(page, 0, 13, COLS)).toBe('');
});

test('the legacy array-of-arrays format is migrated on load', async ({ page }) => {
    // Pre-v2 builds stored a 2D array of single-character strings with "" for
    // blanks. Loading one must upgrade it rather than discard the player's work.
    await openCrossword(page, PUZZLE_WITH_SOLUTIONS);
    await seedLegacyState(page);
    await page.reload();
    await expect(page.locator('#crossword svg')).toBeVisible();

    expect(await letterAt(page, 0, 13, COLS)).toBe('ק');
    expect(await letterAt(page, 0, 12, COLS)).toBe('י');
});

test('the legacy migration is in-memory only until the next edit flushes it', async ({ page }) => {
    // Worth pinning precisely, because it is surprising: loading a legacy blob
    // upgrades the in-memory context but writes nothing back. localStorage keeps
    // the old array until some edit triggers a save. A player who opens the
    // puzzle and closes the tab is still on the legacy format.
    await openCrossword(page, PUZZLE_WITH_SOLUTIONS);
    await seedLegacyState(page);
    await page.reload();
    await expect(page.locator('#crossword svg')).toBeVisible();

    const beforeEdit = await readStoredState(page, PUZZLE_WITH_SOLUTIONS);
    expect(Array.isArray(beforeEdit)).toBe(true);
    expect(beforeEdit.version).toBeUndefined();

    // One keystroke rewrites the whole blob in v2 form, preserving the
    // letters that came from the legacy state.
    await clickCell(page, 0, 11, COLS);
    await typeLetters(page, 'ק');

    const afterEdit = await readStoredState(page, PUZZLE_WITH_SOLUTIONS);
    expect(Array.isArray(afterEdit)).toBe(false);
    expect(afterEdit.version).toBe('2');
    expect(afterEdit.input[0][13]).toBe('ק');
    expect(afterEdit.input[0][12]).toBe('י');
    expect(afterEdit.input[0][11]).toBe('ק');
});

/** Write a pre-v2 saved state for puzzle 1 with two letters already filled. */
async function seedLegacyState(page: import('@playwright/test').Page): Promise<void> {
    await page.evaluate(
        ({ rows, cols }) => {
            const legacy = Array.from({ length: rows }, () =>
                Array.from({ length: cols }, () => ''),
            );
            legacy[0][13] = 'ק';
            legacy[0][12] = 'י';
            localStorage.setItem('crossword_1', JSON.stringify(legacy));
        },
        { rows: ROWS, cols: COLS },
    );
}
