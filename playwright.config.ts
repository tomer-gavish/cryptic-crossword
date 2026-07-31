import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PORT ?? 4173);

/**
 * Escape hatch for sandboxes and CI images that ship a pre-installed Chromium
 * whose build number does not match this Playwright release (where running
 * `npx playwright install` is not an option). Unset on a normal dev machine —
 * Playwright then uses the browser it manages itself.
 */
const chromiumExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const launchOptions = chromiumExecutable ? { executablePath: chromiumExecutable } : {};

/**
 * The suite runs against the *production* bundle in `dist/` served as plain
 * static files — i.e. exactly what GitHub Pages serves. Run `npx webpack
 * --mode production` before testing if you have edited `src/`.
 */
export default defineConfig({
    testDir: './tests',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 1 : undefined,
    reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],

    use: {
        baseURL: `http://127.0.0.1:${PORT}`,
        trace: 'on-first-retry',
        // The app is Hebrew/RTL end to end.
        locale: 'he-IL',
    },

    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'], launchOptions },
        },
        {
            name: 'mobile',
            use: { ...devices['Pixel 7'], launchOptions },
            testMatch: /mobile\..*\.spec\.ts/,
        },
    ],

    webServer: {
        command: `python3 -m http.server ${PORT} --bind 127.0.0.1`,
        url: `http://127.0.0.1:${PORT}/index.json`,
        reuseExistingServer: !process.env.CI,
        stdout: 'ignore',
        stderr: 'pipe',
    },
});
