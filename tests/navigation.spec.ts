/**
 * Characterization: URL routing and the index page.
 *
 * `app.ts` dispatches on four query shapes — `?id=<hex>` (external bucket),
 * `?id=<digits>` (bundled), `?single=<id>.<dir>.<n>`, and everything else
 * (index). Multiplayer adds `?room=`, so the existing matchers and their
 * precedence need pinning first.
 */
import { test, expect, openCrossword, PUZZLE_WITHOUT_SOLUTIONS } from './fixtures';
import * as fs from 'node:fs';
import * as path from 'node:path';

/** A realistic digitized-crossword id: the exporter uses a SHA-1 hex string. */
const EXTERNAL_ID = 'a'.repeat(40);
const BUCKET_URL = 'https://storage.googleapis.com/cryptic-crossword/crosswords';

/**
 * Serve a crossword from the GCS bucket the digitization pipeline uploads to,
 * without touching the network. Reuses puzzle 610 because it has no answer key
 * — exactly like a real digitized crossword.
 */
async function stubBucket(page: import('@playwright/test').Page, id: string): Promise<void> {
    const source = JSON.parse(
        fs.readFileSync(
            path.join(__dirname, '..', 'crosswords', `${PUZZLE_WITHOUT_SOLUTIONS}.json`),
            'utf8',
        ),
    );
    source.id = id;
    await page.route(`${BUCKET_URL}/${id}.json`, (route) =>
        route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(source),
        }),
    );
}

test('the bare URL shows the index with a puzzle picker', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#index')).toBeVisible();
    await expect(page.locator('#wrapper')).not.toBeVisible();

    const options = page.locator('#crossword_select option');
    await expect(options.first()).toBeAttached();
    expect(await options.count()).toBeGreaterThan(500);
});

test('?home shows the index too', async ({ page }) => {
    await page.goto('/?home');
    await expect(page.locator('#index')).toBeVisible();
});

test('changing the index dropdown opens that crossword immediately', async ({ page }) => {
    // The select's `change` and the button's `click` share one handler, so
    // picking an option navigates without needing the button at all.
    await page.goto('/');
    await expect(page.locator('#index')).toBeVisible();

    await page.locator('#crossword_select').selectOption('610');

    await expect(page.locator('#crossword svg')).toBeVisible();
    await expect(page.locator('#title')).toContainText('610');
});

test('the choose button opens whichever crossword is already selected', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#index')).toBeVisible();

    // Ids are listed newest first, so the default selection is the highest id.
    const selected = await page.locator('#crossword_select').inputValue();
    await page.locator('#choose_crossword').click();

    await expect(page.locator('#crossword svg')).toBeVisible();
    await expect(page.locator('#title')).toContainText(selected);
});

test('?id=<digits> loads a bundled crossword', async ({ page }) => {
    await openCrossword(page, '610');
    await expect(page.locator('#title')).toContainText('610');
    await expect(page.locator('#author')).not.toBeEmpty();
});

test('an unknown numeric id falls back to the index instead of erroring', async ({ page }) => {
    await page.goto('/?id=999999');
    await expect(page.locator('#index')).toBeVisible();
    await expect(page.locator('#wrapper')).not.toBeVisible();
});

test('?id=<40 hex> loads a crossword from the external bucket', async ({ page }) => {
    await stubBucket(page, EXTERNAL_ID);
    await page.goto(`/?id=${EXTERNAL_ID}`);

    await expect(page.locator('#crossword svg')).toBeVisible();
    await expect(page.locator('#clues_horizontal dd').first()).toBeVisible();
});

test('external crosswords get their own localStorage scope keyed by hex id', async ({ page }) => {
    await stubBucket(page, EXTERNAL_ID);
    await page.goto(`/?id=${EXTERNAL_ID}`);
    await expect(page.locator('#crossword svg')).toBeVisible();

    // Type into the first square of the top-right clue.
    const box = await page
        .locator('#crossword svg > g')
        .nth(13)
        .locator('rect')
        .boundingBox();
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ק', text: 'ק' });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ק' });

    const keys = await page.evaluate(() => Object.keys(localStorage));
    expect(keys).toContain(`crossword_${EXTERNAL_ID}`);
});

test('an unreachable external id falls back to the index', async ({ page }) => {
    await page.route(`${BUCKET_URL}/*.json`, (route) => route.fulfill({ status: 404, body: '' }));
    await page.goto(`/?id=${'b'.repeat(40)}`);

    await expect(page.locator('#index')).toBeVisible();
});

test('?single= shows one definition on its own', async ({ page }) => {
    await page.goto('/?single=1.across.1');
    await expect(page.locator('#crossword svg')).toBeVisible();

    // The single view rewrites the grid to a single row the length of the answer.
    await expect(page.locator('#crossword svg > g')).toHaveCount(6);
    await expect(page.locator('#title')).toContainText('הגדרה');
    // Clue list is reduced to the one definition, and the vertical list is empty.
    await expect(page.locator('#clues_horizontal dd')).toHaveCount(1);
    await expect(page.locator('#clues_vertical dd')).toHaveCount(0);
});

test('the single view hides solving chrome that does not apply', async ({ page }) => {
    await page.goto('/?single=1.across.1');
    await expect(page.locator('#crossword svg')).toBeVisible();

    await expect(page.locator('#current_definition')).not.toBeVisible();
    await expect(page.locator('#more_options')).not.toBeVisible();
    await expect(page.locator('#current_definition_mark_solved')).not.toBeVisible();
    await expect(page.locator('#share_solution_wrapper')).toHaveCount(0);
});

test('the single view keeps no saved state', async ({ page }) => {
    await page.goto('/?single=1.across.1');
    await expect(page.locator('#crossword svg')).toBeVisible();

    const keys = await page.evaluate(() => Object.keys(localStorage));
    expect(keys.filter((k) => k.startsWith('crossword_'))).toHaveLength(0);
});

test('?single= against a puzzle with no answer key falls back to the index', async ({ page }) => {
    // showSingle throws "No solution for single!" and app.ts catches it.
    await page.goto(`/?single=${PUZZLE_WITHOUT_SOLUTIONS}.across.1`);
    await expect(page.locator('#index')).toBeVisible();
});
