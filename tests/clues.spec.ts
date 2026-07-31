/**
 * Characterization: the clue lists and the current-definition chrome.
 *
 * The "mark solved" state is the second thing multiplayer will sync (after
 * letters), so the wiring between checkbox, list styling, and the toolbar
 * button needs to be nailed down before any of it moves.
 */
import {
    test,
    expect,
    openCrossword,
    clickCell,
    clueCheckbox,
    PUZZLE_WITH_SOLUTIONS,
} from './fixtures';

const COLS = 14;
const ACROSS_CLUE_COUNT = 16;
const DOWN_CLUE_COUNT = 14;

test.beforeEach(async ({ page }) => {
    await openCrossword(page, PUZZLE_WITH_SOLUTIONS);
});

test('both clue lists render under their headings', async ({ page }) => {
    await expect(page.locator('#clues_horizontal h3')).toHaveText('מאוזן');
    await expect(page.locator('#clues_vertical h3')).toHaveText('מאונך');
    await expect(page.locator('#clues_horizontal dd')).toHaveCount(ACROSS_CLUE_COUNT);
    await expect(page.locator('#clues_vertical dd')).toHaveCount(DOWN_CLUE_COUNT);
});

test('each clue is labelled with its number and carries a checkbox', async ({ page }) => {
    await expect(page.locator('#clues_horizontal dt').first()).toContainText('[1]');
    await expect(clueCheckbox(page, 1, 'across')).toBeAttached();
    await expect(clueCheckbox(page, 1, 'across')).not.toBeChecked();
});

test('clicking a clue selects its squares in the grid', async ({ page }) => {
    await page.locator('#clues_horizontal dd').first().click();

    // Across-1 starts at (0,13) and runs left.
    await expect(page.locator('#crossword svg > g').nth(13).locator('rect')).toHaveAttribute(
        'fill',
        '#ffffcc',
    );
    await expect(page.locator('#crossword svg > g').nth(12).locator('rect')).toHaveAttribute(
        'fill',
        '#ccffff',
    );
});

test('the current definition is blank until a square is selected', async ({ page }) => {
    await expect(page.locator('#current_definition')).toHaveText('[בחרו הגדרה]');
    await expect(page.locator('#more_options')).toBeDisabled();
    await expect(page.locator('#current_definition_mark_solved')).toBeDisabled();
});

test('selecting a square shows that clue and enables the toolbar', async ({ page }) => {
    await clickCell(page, 0, 13, COLS);

    await expect(page.locator('#current_definition')).toContainText('שמן עם פה אבל בלי עין');
    await expect(page.locator('#more_options')).toBeEnabled();
    await expect(page.locator('#current_definition_mark_solved')).toBeEnabled();
});

test('the shown definition follows the selected direction', async ({ page }) => {
    // (2,13) starts both across-8 and down-8, which have different texts.
    await clickCell(page, 2, 13, COLS);
    const first = await page.locator('#current_definition').textContent();

    await clickCell(page, 2, 13, COLS);
    const afterSwap = await page.locator('#current_definition').textContent();

    expect(first).not.toBe(afterSwap);
});

test('checking a clue marks it solved in the list', async ({ page }) => {
    await clueCheckbox(page, 8, 'across').check();

    await expect(page.locator('#clues_horizontal dd.solved')).toHaveCount(1);
    await clueCheckbox(page, 8, 'across').uncheck();
    await expect(page.locator('#clues_horizontal dd.solved')).toHaveCount(0);
});

test('the toolbar button toggles the selected clue solved', async ({ page }) => {
    await clickCell(page, 0, 13, COLS);
    await page.locator('#current_definition_mark_solved').click();

    await expect(clueCheckbox(page, 1, 'across')).toBeChecked();
    await expect(page.locator('#clues_horizontal dd.solved')).toHaveCount(1);

    await page.locator('#current_definition_mark_solved').click();
    await expect(clueCheckbox(page, 1, 'across')).not.toBeChecked();
});

test('the toolbar button reflects the solved state of the selected clue', async ({ page }) => {
    await clueCheckbox(page, 1, 'across').check();
    await clickCell(page, 0, 13, COLS);

    await expect(page.locator('#current_definition_mark_solved')).toHaveAttribute(
        'data-solved',
        'true',
    );
});

test('across and down clues with the same number are tracked separately', async ({ page }) => {
    // Clue 8 exists in both directions on this puzzle.
    await clueCheckbox(page, 8, 'across').check();

    await expect(clueCheckbox(page, 8, 'down')).not.toBeChecked();
    await expect(page.locator('#clues_horizontal dd.solved')).toHaveCount(1);
    await expect(page.locator('#clues_vertical dd.solved')).toHaveCount(0);
});
