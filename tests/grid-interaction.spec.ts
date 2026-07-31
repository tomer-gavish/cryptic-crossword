/**
 * Characterization: selecting squares, typing, and cursor movement.
 *
 * Fixture puzzle 1 is 14x14 RTL. Useful landmarks:
 *   (0,13) clue 1  — across only, runs leftward to (0,8)
 *   (0,10) clue 3  — down only, but also sits inside across-1's run
 *   (2,13) clue 8  — starts BOTH an across and a down clue
 */
import {
    test,
    expect,
    openCrossword,
    clickCell,
    cellRect,
    cellLetter,
    letterAt,
    dummyInput,
    typeLetters,
    PUZZLE_WITH_SOLUTIONS,
} from './fixtures';

const COLS = 14;
const SELECTED = '#ffffcc';
const IN_DEFINITION = '#ccffff';

test.beforeEach(async ({ page }) => {
    await openCrossword(page, PUZZLE_WITH_SOLUTIONS);
});

test('clicking a square highlights it yellow and its definition blue', async ({ page }) => {
    await clickCell(page, 0, 13, COLS);

    await expect(cellRect(page, 0, 13, COLS)).toHaveAttribute('fill', SELECTED);
    // The rest of across-1 (cols 12..8) is the definition.
    for (const col of [12, 11, 10, 9, 8]) {
        await expect(cellRect(page, 0, col, COLS)).toHaveAttribute('fill', IN_DEFINITION);
    }
    // Col 7 is a blocked square and must stay black.
    await expect(cellRect(page, 0, 7, COLS)).toHaveAttribute('fill', 'black');
});

test('selecting a square focuses its hidden input — this is what makes typing work', async ({
    page,
}) => {
    await clickCell(page, 0, 13, COLS);
    await expect(dummyInput(page, 0, 13)).toBeFocused();
});

test('clicking the same square twice swaps direction when it starts two clues', async ({
    page,
}) => {
    // (2,13) starts both across-8 and down-8.
    await clickCell(page, 2, 13, COLS);
    const firstNeighbour = await cellRect(page, 2, 12, COLS).getAttribute('fill');

    await clickCell(page, 2, 13, COLS);
    const afterSwapNeighbour = await cellRect(page, 2, 12, COLS).getAttribute('fill');
    const verticalNeighbour = await cellRect(page, 3, 13, COLS).getAttribute('fill');

    // One of the two axes is lit before the swap and the other after it.
    expect(firstNeighbour).not.toBe(afterSwapNeighbour);
    expect(verticalNeighbour).toBe(IN_DEFINITION);
});

test('clicking a square that starts exactly one clue adopts that clue direction', async ({
    page,
}) => {
    // (0,10) starts down-3 only. Selecting it should light the vertical run,
    // even though the square also belongs to across-1.
    await clickCell(page, 0, 10, COLS);

    await expect(cellRect(page, 0, 10, COLS)).toHaveAttribute('fill', SELECTED);
    await expect(cellRect(page, 1, 10, COLS)).toHaveAttribute('fill', IN_DEFINITION);
    await expect(cellRect(page, 2, 10, COLS)).toHaveAttribute('fill', IN_DEFINITION);
});

test('typing a letter fills the square and advances to the next one', async ({ page }) => {
    await clickCell(page, 0, 13, COLS);
    await typeLetters(page, 'ק');

    await expect(cellLetter(page, 0, 13, COLS)).toHaveText('ק');
    // RTL: the next square of across-1 is one column to the left.
    await expect(dummyInput(page, 0, 12)).toBeFocused();
    await expect(cellRect(page, 0, 12, COLS)).toHaveAttribute('fill', SELECTED);
});

test('typing a whole answer fills the run left-to-right in RTL order', async ({ page }) => {
    await clickCell(page, 0, 13, COLS);
    await typeLetters(page, 'קיקלופ');

    const written = [];
    for (const col of [13, 12, 11, 10, 9, 8]) {
        written.push(await letterAt(page, 0, col, COLS));
    }
    expect(written.join('')).toBe('קיקלופ');
});

test('Backspace clears the square and steps back', async ({ page }) => {
    await clickCell(page, 0, 13, COLS);
    await typeLetters(page, 'קי');
    // Cursor now sits on (0,11).
    await page.keyboard.press('Backspace');

    await expect(cellLetter(page, 0, 11, COLS)).toHaveText('');
    await expect(dummyInput(page, 0, 12)).toBeFocused();
});

test('Delete clears the square without moving', async ({ page }) => {
    await clickCell(page, 0, 13, COLS);
    await typeLetters(page, 'ק');
    await clickCell(page, 0, 13, COLS);
    await page.keyboard.press('Delete');

    await expect(cellLetter(page, 0, 13, COLS)).toHaveText('');
    await expect(dummyInput(page, 0, 13)).toBeFocused();
});

test('Hebrew final letters are normalized to their regular form', async ({ page }) => {
    await clickCell(page, 0, 13, COLS);
    await typeLetters(page, 'םןףץך');

    const written = [];
    for (const col of [13, 12, 11, 10, 9]) {
        written.push(await letterAt(page, 0, col, COLS));
    }
    expect(written.join('')).toBe('מנפצכ');
});

test('latin letters are accepted but rendered red', async ({ page }) => {
    await clickCell(page, 0, 13, COLS);
    await typeLetters(page, 'a');

    await expect(cellLetter(page, 0, 13, COLS)).toHaveText('a');
    await expect(cellLetter(page, 0, 13, COLS)).toHaveAttribute('fill', 'red');
});

test('hebrew letters are rendered black', async ({ page }) => {
    await clickCell(page, 0, 13, COLS);
    await typeLetters(page, 'ק');
    await expect(cellLetter(page, 0, 13, COLS)).toHaveAttribute('fill', 'black');
});

test('digits and punctuation are ignored', async ({ page }) => {
    await clickCell(page, 0, 13, COLS);
    await typeLetters(page, '5');
    await typeLetters(page, '!');

    await expect(cellLetter(page, 0, 13, COLS)).toHaveText('');
    // Cursor has not moved.
    await expect(dummyInput(page, 0, 13)).toBeFocused();
});

test('typing does nothing when no square is selected', async ({ page }) => {
    await typeLetters(page, 'ק');
    await expect(cellLetter(page, 0, 13, COLS)).toHaveText('');
});

test('blocked squares are not selectable', async ({ page }) => {
    // (0,7) is blocked; clicking must not move the selection there.
    await clickCell(page, 0, 13, COLS);
    await clickCell(page, 0, 7, COLS);

    await expect(cellRect(page, 0, 7, COLS)).toHaveAttribute('fill', 'black');
    await expect(cellRect(page, 0, 13, COLS)).toHaveAttribute('fill', SELECTED);
});
