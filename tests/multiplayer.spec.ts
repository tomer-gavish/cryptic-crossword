/**
 * Two players, one grid, against the Firebase emulator.
 *
 * This is the suite that closes the gap left by the state refactor:
 * `handleRemoteChange` had no test, because nothing could produce a change with
 * `origin: 'remote'`. Everything here drives that path for real — two browser
 * contexts, two anonymous uids, one room.
 *
 * Each test mints its own room id, so they are isolated without any teardown
 * and safe to run in parallel.
 */
import {
    test,
    expect,
    openRoom,
    newPlayerPage,
    uniqueRoomId,
    clickCell,
    cellLetter,
    letterAt,
    typeLetters,
    clueCheckbox,
    PUZZLE_WITH_SOLUTIONS,
} from './fixtures';

const COLS = 14;

/**
 * If every test in this file times out at once, suspect the *auth* emulator
 * rather than anything here. Playwright decides the emulator webServer is
 * ready by probing one URL, and ours probes the database; a stale process can
 * leave the database answering on 9000 while nothing listens on 9099, and then
 * anonymous sign-in never resolves. Confirm with:
 *
 *     curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:9099/
 *
 * and stop the stale emulator so the suite can start a fresh one.
 */
test.describe('shared room', () => {
    test('a letter typed by one player appears for the other', async ({ page, browser }) => {
        const roomId = uniqueRoomId();
        const other = await newPlayerPage(browser);

        await openRoom(page, PUZZLE_WITH_SOLUTIONS, roomId);
        await openRoom(other.page, PUZZLE_WITH_SOLUTIONS, roomId);

        await clickCell(page, 0, 13, COLS);
        await typeLetters(page, 'ק');

        await expect(cellLetter(other.page, 0, 13, COLS)).toHaveText('ק');
        await other.close();
    });

    test('a whole answer replicates in order', async ({ page, browser }) => {
        const roomId = uniqueRoomId();
        const other = await newPlayerPage(browser);

        await openRoom(page, PUZZLE_WITH_SOLUTIONS, roomId);
        await openRoom(other.page, PUZZLE_WITH_SOLUTIONS, roomId);

        await clickCell(page, 0, 13, COLS);
        await typeLetters(page, 'קיקלופ');

        await expect(cellLetter(other.page, 0, 8, COLS)).toHaveText('פ');
        const mirrored: string[] = [];
        for (const col of [13, 12, 11, 10, 9, 8]) {
            mirrored.push(await letterAt(other.page, 0, col, COLS));
        }
        expect(mirrored.join('')).toBe('קיקלופ');
        await other.close();
    });

    test('clearing a square clears it for everyone', async ({ page, browser }) => {
        const roomId = uniqueRoomId();
        const other = await newPlayerPage(browser);

        await openRoom(page, PUZZLE_WITH_SOLUTIONS, roomId);
        await openRoom(other.page, PUZZLE_WITH_SOLUTIONS, roomId);

        await clickCell(page, 0, 13, COLS);
        await typeLetters(page, 'ק');
        await expect(cellLetter(other.page, 0, 13, COLS)).toHaveText('ק');

        await clickCell(page, 0, 13, COLS);
        await page.keyboard.press('Delete');

        await expect(cellLetter(other.page, 0, 13, COLS)).toHaveText('');
        await other.close();
    });

    /**
     * The reason the sync unit is a single cell rather than the row-string blob
     * the local format uses. With whole-document writes this is exactly the
     * case that loses data.
     */
    test('edits to different squares do not clobber each other', async ({ page, browser }) => {
        const roomId = uniqueRoomId();
        const other = await newPlayerPage(browser);

        await openRoom(page, PUZZLE_WITH_SOLUTIONS, roomId);
        await openRoom(other.page, PUZZLE_WITH_SOLUTIONS, roomId);

        // Two players working the same across clue from opposite ends.
        await clickCell(page, 0, 13, COLS);
        await clickCell(other.page, 0, 8, COLS);
        await Promise.all([typeLetters(page, 'ק'), typeLetters(other.page, 'פ')]);

        // Both letters survive, in both browsers.
        await expect(cellLetter(page, 0, 13, COLS)).toHaveText('ק');
        await expect(cellLetter(page, 0, 8, COLS)).toHaveText('פ');
        await expect(cellLetter(other.page, 0, 13, COLS)).toHaveText('ק');
        await expect(cellLetter(other.page, 0, 8, COLS)).toHaveText('פ');
        await other.close();
    });

    test('both players converge on one letter when they type in the same square', async ({
        page,
        browser,
    }) => {
        const roomId = uniqueRoomId();
        const other = await newPlayerPage(browser);

        await openRoom(page, PUZZLE_WITH_SOLUTIONS, roomId);
        await openRoom(other.page, PUZZLE_WITH_SOLUTIONS, roomId);

        await clickCell(page, 0, 13, COLS);
        await clickCell(other.page, 0, 13, COLS);

        await typeLetters(page, 'ק');
        await expect(cellLetter(other.page, 0, 13, COLS)).toHaveText('ק');

        // The second writer wins, and the first player is updated to match.
        await typeLetters(other.page, 'ב');
        await expect(cellLetter(page, 0, 13, COLS)).toHaveText('ב');
        await expect(cellLetter(other.page, 0, 13, COLS)).toHaveText('ב');
        await other.close();
    });

    test('marking a clue solved replicates', async ({ page, browser }) => {
        const roomId = uniqueRoomId();
        const other = await newPlayerPage(browser);

        await openRoom(page, PUZZLE_WITH_SOLUTIONS, roomId);
        await openRoom(other.page, PUZZLE_WITH_SOLUTIONS, roomId);

        await clueCheckbox(page, 8, 'across').check();

        await expect(clueCheckbox(other.page, 8, 'across')).toBeChecked();
        await expect(other.page.locator('#clues_horizontal dd.solved')).toHaveCount(1);
        await other.close();
    });

    test('unmarking a clue replicates too, and does not ping-pong', async ({ page, browser }) => {
        const roomId = uniqueRoomId();
        const other = await newPlayerPage(browser);

        await openRoom(page, PUZZLE_WITH_SOLUTIONS, roomId);
        await openRoom(other.page, PUZZLE_WITH_SOLUTIONS, roomId);

        await clueCheckbox(page, 8, 'across').check();
        await expect(clueCheckbox(other.page, 8, 'across')).toBeChecked();

        await clueCheckbox(page, 8, 'across').uncheck();
        await expect(clueCheckbox(other.page, 8, 'across')).not.toBeChecked();

        // Applying a remote mark re-dispatches the checkbox's change event so
        // the list styling follows. If that write-back were not suppressed the
        // two browsers would bounce the value between them; settling proves it
        // is.
        await page.waitForTimeout(500);
        await expect(clueCheckbox(page, 8, 'across')).not.toBeChecked();
        await expect(clueCheckbox(other.page, 8, 'across')).not.toBeChecked();
        await other.close();
    });

    test('a player joining later sees the work already done', async ({ page, browser }) => {
        const roomId = uniqueRoomId();

        await openRoom(page, PUZZLE_WITH_SOLUTIONS, roomId);
        await clickCell(page, 0, 13, COLS);
        await typeLetters(page, 'קיק');
        await clueCheckbox(page, 8, 'across').check();

        // Only now does the second player open the link.
        const latecomer = await newPlayerPage(browser);
        await openRoom(latecomer.page, PUZZLE_WITH_SOLUTIONS, roomId);

        expect(await letterAt(latecomer.page, 0, 13, COLS)).toBe('ק');
        expect(await letterAt(latecomer.page, 0, 12, COLS)).toBe('י');
        expect(await letterAt(latecomer.page, 0, 11, COLS)).toBe('ק');
        await expect(clueCheckbox(latecomer.page, 8, 'across')).toBeChecked();
        await latecomer.close();
    });

    test('room state is per room, not global', async ({ page, browser }) => {
        const roomA = uniqueRoomId();
        const roomB = uniqueRoomId();
        const other = await newPlayerPage(browser);

        await openRoom(page, PUZZLE_WITH_SOLUTIONS, roomA);
        await openRoom(other.page, PUZZLE_WITH_SOLUTIONS, roomB);

        await clickCell(page, 0, 13, COLS);
        await typeLetters(page, 'ק');
        await expect(cellLetter(page, 0, 13, COLS)).toHaveText('ק');

        // Give any cross-talk a chance to show up before asserting absence.
        await page.waitForTimeout(500);
        expect(await letterAt(other.page, 0, 13, COLS)).toBe('');
        await other.close();
    });

    test('a room does not write the solo localStorage state', async ({ page }) => {
        const roomId = uniqueRoomId();
        await openRoom(page, PUZZLE_WITH_SOLUTIONS, roomId);

        await clickCell(page, 0, 13, COLS);
        await typeLetters(page, 'ק');
        await expect(cellLetter(page, 0, 13, COLS)).toHaveText('ק');

        const solo = await page.evaluate(() => localStorage.getItem('crossword_1'));
        expect(solo).toBeNull();
    });

    test('solo play is untouched by the room route', async ({ page }) => {
        // Same puzzle, no ?room= — must still use localStorage.
        await page.goto(`/?id=${PUZZLE_WITH_SOLUTIONS}`);
        await expect(page.locator('#crossword svg')).toBeVisible();

        await clickCell(page, 0, 13, COLS);
        await typeLetters(page, 'ק');

        const solo = await page.evaluate(() => localStorage.getItem('crossword_1'));
        expect(solo).not.toBeNull();
        expect(JSON.parse(solo!).input[0][13]).toBe('ק');
    });
});
