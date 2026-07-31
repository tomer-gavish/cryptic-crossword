/**
 * Characterization: what changes when a puzzle ships without an answer key.
 *
 * 603 of the 608 upstream crosswords carry `solutions`/`sol_grid`/`sol_hash`;
 * 5 do not (144, 353, 477, 478, 610) — and *every* digitized crossword looks
 * like the latter, since the export only emits
 * {author, dimensions, grid, definitions, id}.
 *
 * These tests record how much already degrades gracefully. That turned out to
 * be more than expected, so they double as the scoping evidence for how narrow
 * the remaining solutions work actually is.
 */
import {
    test,
    expect,
    openCrossword,
    clickCell,
    cellRect,
    PUZZLE_WITH_SOLUTIONS,
    PUZZLE_WITHOUT_SOLUTIONS,
} from './fixtures';

const COLS = 14;

/** Right-click a square to raise the per-clue options popover. */
async function openContextMenu(page: import('@playwright/test').Page, row: number, col: number) {
    const box = await cellRect(page, row, col, COLS).boundingBox();
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2, { button: 'right' });
    await expect(page.locator('.popover')).toBeVisible();
}

test.describe('puzzle with an answer key', () => {
    test.beforeEach(async ({ page }) => {
        await openCrossword(page, PUZZLE_WITH_SOLUTIONS);
    });

    test('shows the crossword/solution tabs', async ({ page }) => {
        await expect(page.locator('#tabs_header')).toBeVisible();
        await expect(page.locator('#tabs_header .nav-link')).toHaveCount(2);
    });

    test('renders a full solution grid in the solution tab', async ({ page }) => {
        await expect(page.locator('#solution_tab_content svg')).toHaveCount(1);
    });

    test('offers a check-solution button', async ({ page }) => {
        await expect(page.locator('#check_solution_wrapper button')).toBeVisible();
    });

    test('an incorrect grid is reported as not yet right', async ({ page }) => {
        await clickCell(page, 0, 13, COLS);
        await page.locator('#check_solution_wrapper button').click();

        await expect(page.locator('#solution_modal')).toBeVisible();
        await expect(page.locator('#solution_message')).toContainText('לא בדיוק');
        await expect(page.locator('#solution_modal .modal-header')).toHaveClass(/failure/);
    });

    test('the context menu offers check and reveal for a clue', async ({ page }) => {
        await clickCell(page, 0, 13, COLS);
        await openContextMenu(page, 0, 13);

        await expect(page.locator('.popover')).toContainText('בדיקת נכונות הפתרון');
        await expect(page.locator('.popover')).toContainText('צפייה בפתרון ההגדרה');
    });

    test('revealing a clue prints the answer without filling the grid', async ({ page }) => {
        await clickCell(page, 0, 13, COLS);
        await openContextMenu(page, 0, 13);
        // The popover is inserted inside the SVG (no `container` option is
        // passed to bootstrap.Popover), so the grid wins hit-testing against
        // its buttons and a positional click cannot reach them. Dispatching on
        // the button exercises the handler under test rather than Bootstrap's
        // stacking context.
        await page
            .locator('.popover button', { hasText: 'צפייה בפתרון ההגדרה' })
            .dispatchEvent('click');

        await expect(page.locator('.context_menu_placeholder')).toContainText('קיקלופ');
        // Reveal is informational only — the squares stay empty.
        await expect(
            page.locator('#crossword svg > g').nth(13).locator('text.letter_elem_text'),
        ).toHaveText('');
    });
});

test.describe('puzzle without an answer key', () => {
    test.beforeEach(async ({ page }) => {
        await openCrossword(page, PUZZLE_WITHOUT_SOLUTIONS);
    });

    test('hides the tab bar entirely', async ({ page }) => {
        await expect(page.locator('#tabs_header')).not.toBeVisible();
    });

    test('offers no check-solution button', async ({ page }) => {
        await expect(page.locator('#check_solution_wrapper button')).toHaveCount(0);
    });

    test('renders no solution grid', async ({ page }) => {
        await expect(page.locator('#solution_tab_content svg')).toHaveCount(0);
    });

    test('the context menu omits check and reveal but keeps word boundaries', async ({ page }) => {
        await clickCell(page, 0, 13, COLS);
        await openContextMenu(page, 0, 13);

        await expect(page.locator('.popover')).toContainText('סימון גבולות מילה');
        await expect(page.locator('.popover')).not.toContainText('בדיקת נכונות הפתרון');
        await expect(page.locator('.popover')).not.toContainText('צפייה בפתרון ההגדרה');
    });

    test('solving still works normally — grid, clues and sharing are unaffected', async ({
        page,
    }) => {
        await expect(page.locator('#crossword svg')).toBeVisible();
        await expect(page.locator('#clues_horizontal dd').first()).toBeVisible();
        await expect(page.locator('#clues_vertical dd').first()).toBeVisible();
        await expect(page.locator('#share_solution_wrapper')).toBeVisible();
        await expect(page.locator('#clues_horizontal input.clue_checkbox').first()).toBeAttached();
    });
});
