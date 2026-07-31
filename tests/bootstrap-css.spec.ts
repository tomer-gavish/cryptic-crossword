/**
 * Guards that Bootstrap's stylesheet is actually in effect.
 *
 * This is not paranoia. index.html loads the stylesheet from a CDN under an
 * SRI hash; the test suite substitutes the copy npm installed. If those two
 * ever describe different versions, the hash fails, the browser blocks the
 * stylesheet, and *nothing complains* — the page still renders, the suite still
 * passes, and every visibility assertion quietly starts testing an unstyled
 * page. That is exactly what happened while `package.json` asked for `^5.2.3`
 * and npm resolved it to 5.3.x.
 *
 * So: assert a rule that can only be in effect if the stylesheet loaded.
 */
import { test, expect, openCrossword, PUZZLE_WITH_SOLUTIONS } from './fixtures';

test('the Bootstrap stylesheet loads and applies', async ({ page }) => {
    await openCrossword(page, PUZZLE_WITH_SOLUTIONS);

    // Padding and border radius on .btn come from Bootstrap's own custom
    // properties (0.375rem = 6px) and survive the site's overrides —
    // `display` does not, since css/style.css sets its own.
    const style = await page
        .locator('#share_solution_wrapper button')
        .evaluate((element) => {
            const computed = getComputedStyle(element);
            return {
                paddingTop: computed.paddingTop,
                borderRadius: computed.borderRadius,
            };
        });

    expect(style.paddingTop).toBe('6px');
    expect(style.borderRadius).toBe('6px');
});

test('the version npm installs matches the hash index.html pins', async ({ page }) => {
    // A direct check on the substitution itself: if the browser had rejected
    // the stylesheet for a bad hash, it would not appear among the document's
    // stylesheets with readable rules.
    await openCrossword(page, PUZZLE_WITH_SOLUTIONS);

    const bootstrapRuleCount = await page.evaluate(() => {
        for (const sheet of Array.from(document.styleSheets)) {
            if (sheet.href?.includes('bootstrap')) {
                try {
                    return sheet.cssRules.length;
                } catch {
                    return -1; // blocked or opaque
                }
            }
        }
        return 0; // not present at all
    });

    expect(bootstrapRuleCount).toBeGreaterThan(100);
});
