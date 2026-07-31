/**
 * Waits for the whole Firebase emulator suite, not just part of it.
 *
 * Playwright decides a `webServer` is ready by polling a single URL, and ours
 * polls the database emulator. But `firebase emulators:start` brings the
 * database and auth emulators up independently, so the database can be
 * answering on 9000 while nothing is listening on 9099 yet. Tests then start,
 * anonymous sign-in never resolves, and the first multiplayer test fails while
 * everything about the database looks healthy.
 *
 * The same shape appears for a different reason once the run is over: if the
 * CLI is killed before it can stop its Java child, that child keeps holding
 * port 9000, and the next run reuses the half-dead emulator. `gracefulShutdown`
 * in the config prevents that; this check catches it either way.
 */
import type { FullConfig } from '@playwright/test';

const AUTH_URL = 'http://127.0.0.1:9099/';
const DATABASE_URL = 'http://127.0.0.1:9000/.json?ns=demo-crossword';

async function waitForEmulator(name: string, url: string, timeoutMs = 60_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let lastError = 'no response';

    while (Date.now() < deadline) {
        try {
            const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
            if (response.status < 500) {
                return;
            }
            lastError = `HTTP ${response.status}`;
        } catch (error) {
            lastError = (error as Error).message;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
    }

    throw new Error(
        `The Firebase ${name} emulator never became ready at ${url} (${lastError}).\n` +
            'If the database answers on 9000 but auth does not on 9099, a previous run ' +
            'most likely orphaned the database emulator: it is a Java child of the CLI ' +
            'and survives if the CLI is killed first, after which reuseExistingServer ' +
            'reuses it and auth is never started. See tests/README.md.',
    );
}

export default async function globalSetup(_config: FullConfig): Promise<void> {
    await Promise.all([
        waitForEmulator('database', DATABASE_URL),
        waitForEmulator('auth', AUTH_URL),
    ]);
}
