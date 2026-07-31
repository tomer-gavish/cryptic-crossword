/**
 * Runtime configuration.
 *
 * The Firebase web config is *public by design* — it identifies the project,
 * it does not authorise anything. Access is controlled by the security rules
 * in `database.rules.json` and by anonymous auth, not by keeping these values
 * secret. So they belong in the repo, alongside the bucket URL that was
 * already hard-coded in app.ts.
 */

export const EXTERNAL_STORAGE_BASE_URL =
    'https://storage.googleapis.com/cryptic-crossword/crosswords';

export type FirebaseSettings = {
    apiKey: string;
    authDomain: string;
    databaseURL: string;
    projectId: string;
    appId: string;
};

/**
 * The emulator suite, used by the test suite and by `npm run dev:emulator`.
 * A `demo-` project id makes Firebase refuse to contact any real backend, so
 * a misconfigured test can never write to production data.
 */
const EMULATOR_SETTINGS: FirebaseSettings = {
    apiKey: 'demo-api-key',
    authDomain: 'demo-crossword.firebaseapp.com',
    databaseURL: 'http://127.0.0.1:9000?ns=demo-crossword',
    projectId: 'demo-crossword',
    appId: 'demo-app-id',
};

/**
 * TODO: fill in from the Firebase console once the project is attached to the
 * existing GCP project. Until then, multiplayer works against the emulator
 * only — `?room=` on the deployed site will fail to connect, which is why no
 * UI links to it yet.
 */
const PRODUCTION_SETTINGS: FirebaseSettings = {
    apiKey: '',
    authDomain: '',
    databaseURL: '',
    projectId: '',
    appId: '',
};

export function isEmulatorHost(hostname: string = window.location.hostname): boolean {
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

export function firebaseSettings(): FirebaseSettings {
    return isEmulatorHost() ? EMULATOR_SETTINGS : PRODUCTION_SETTINGS;
}

export function isFirebaseConfigured(): boolean {
    return firebaseSettings().databaseURL !== '';
}
