/**
 * Shared multiplayer state, backed by Firebase Realtime Database.
 *
 * The display layer talks to this exactly as it talks to
 * `LocalStorageContext` — same interface, same synchronous getters. RTDB is
 * asynchronous, so this keeps an in-memory mirror of the room: `init()` loads
 * the first snapshot, listeners keep it current, and the getters read the
 * mirror.
 *
 * ## Why the sync unit is one cell
 *
 * The saved format is one string per grid row. Syncing that would make every
 * keystroke a whole-document write, so two players typing in *different*
 * squares would clobber each other. Writing `rooms/{id}/cells/{row}_{col}`
 * instead makes concurrent edits to different squares independent, and
 * concurrent edits to the *same* square resolve last-write-wins — which is
 * what someone sitting across the table would expect anyway.
 *
 * ## Local vs remote
 *
 * Every record carries `by`, the uid that wrote it. An event whose `by` is our
 * own uid is the echo of an edit the display has already drawn, so it is
 * reported as `local` and changes nothing. Anything else is somebody else's
 * work and is reported as `remote`, which is what makes it repaint.
 */
import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import {
    connectAuthEmulator,
    getAuth,
    signInAnonymously,
    type Auth,
} from 'firebase/auth';
import {
    get,
    getDatabase,
    onChildChanged,
    onChildRemoved,
    onChildAdded,
    ref,
    remove,
    set,
    type Database,
    type DatabaseReference,
} from 'firebase/database';

import { firebaseSettings, isEmulatorHost } from '../config';
import type { Coordinate, DirectionKey } from '../types';
import {
    StorageSource,
    type ICrosswordState,
    type StateChange,
    type StateChangeListener,
} from './ICrosswordState';

const EMPTY_CHAR = '?';

type CellRecord = { ch: string; by: string; at: number };
type SolvedRecord = { v: boolean; by: string; at: number };

export type RoomOptions = {
    roomId: string;
    crosswordId: number | string;
    rows: number;
    cols: number;
    maxClueAcross: number;
    maxClueDown: number;
};

/** `rooms/{id}/cells/{row}_{col}` */
function cellKey(coordinate: Coordinate): string {
    return `${coordinate.row}_${coordinate.col}`;
}

function parseCellKey(key: string): Coordinate | null {
    const match = /^(\d+)_(\d+)$/.exec(key);
    return match ? { row: Number(match[1]), col: Number(match[2]) } : null;
}

/** `rooms/{id}/solved/{across|down}_{clueId}` */
function solvedKey(clueId: number, direction: DirectionKey): string {
    return `${direction}_${clueId}`;
}

function parseSolvedKey(key: string): { clueId: number; direction: DirectionKey } | null {
    const match = /^(across|down)_(\d+)$/.exec(key);
    return match
        ? { direction: match[1] as DirectionKey, clueId: Number(match[2]) }
        : null;
}

export class RoomStorageContext implements ICrosswordState {
    private readonly options: RoomOptions;

    private app!: FirebaseApp;
    private auth!: Auth;
    private db!: Database;
    private roomRef!: DatabaseReference;
    private uid = '';

    /** In-memory mirror, so the interface's getters can stay synchronous. */
    private letters = new Map<string, string>();
    private solved = new Map<string, boolean>();

    private listeners: StateChangeListener[] = [];
    private detachers: Array<() => void> = [];

    constructor(options: RoomOptions) {
        this.options = options;
    }

    public async init(): Promise<void> {
        const settings = firebaseSettings();
        this.app =
            getApps().find((candidate) => candidate.name === '[DEFAULT]') ??
            initializeApp(settings);

        this.auth = getAuth(this.app);
        this.db = getDatabase(this.app);

        if (isEmulatorHost()) {
            // The database needs no `connectDatabaseEmulator` call: the
            // emulator settings already point `databaseURL` straight at it.
            // Auth does, because its `authDomain` is a placeholder. The call
            // throws if repeated on one instance, which happens whenever a
            // page re-enters showCrossword.
            try {
                connectAuthEmulator(this.auth, 'http://127.0.0.1:9099', {
                    disableWarnings: true,
                });
            } catch {
                /* already connected */
            }
        }

        const credential = await signInAnonymously(this.auth);
        this.uid = credential.user.uid;

        this.roomRef = ref(this.db, `rooms/${this.options.roomId}`);
        await this.ensureMeta();
        await this.loadSnapshot();
        this.attachListeners();
    }

    /** Claim the room on first use. Existing rooms are left alone. */
    private async ensureMeta(): Promise<void> {
        const metaRef = ref(this.db, `rooms/${this.options.roomId}/meta`);
        const existing = await get(metaRef);
        if (existing.exists()) {
            return;
        }
        await set(metaRef, {
            crosswordId: String(this.options.crosswordId),
            rows: this.options.rows,
            cols: this.options.cols,
            createdBy: this.uid,
            createdAt: Date.now(),
            lastActiveAt: Date.now(),
        });
    }

    private async loadSnapshot(): Promise<void> {
        const [cells, solved] = await Promise.all([
            get(ref(this.db, `rooms/${this.options.roomId}/cells`)),
            get(ref(this.db, `rooms/${this.options.roomId}/solved`)),
        ]);

        cells.forEach((child) => {
            const record = child.val() as CellRecord;
            if (child.key) {
                this.letters.set(child.key, record.ch);
            }
        });
        solved.forEach((child) => {
            const record = child.val() as SolvedRecord;
            if (child.key) {
                this.solved.set(child.key, record.v);
            }
        });
    }

    private attachListeners(): void {
        const cellsRef = ref(this.db, `rooms/${this.options.roomId}/cells`);
        const solvedRef = ref(this.db, `rooms/${this.options.roomId}/solved`);

        const onCell = (key: string | null, record: CellRecord | null) => {
            if (key === null) {
                return;
            }
            const coordinate = parseCellKey(key);
            if (coordinate === null) {
                return;
            }
            const letter = record?.ch ?? '';
            this.letters.set(key, letter);
            this.emit({
                kind: 'letter',
                coordinate,
                letter,
                origin: record !== null && record.by === this.uid ? 'local' : 'remote',
            });
        };

        const onSolved = (key: string | null, record: SolvedRecord | null) => {
            if (key === null) {
                return;
            }
            const parsed = parseSolvedKey(key);
            if (parsed === null) {
                return;
            }
            const value = record?.v ?? false;
            this.solved.set(key, value);
            this.emit({
                kind: 'solved',
                clueId: parsed.clueId,
                direction: parsed.direction,
                solved: value,
                origin: record !== null && record.by === this.uid ? 'local' : 'remote',
            });
        };

        this.detachers.push(
            onChildAdded(cellsRef, (snap) => onCell(snap.key, snap.val())),
            onChildChanged(cellsRef, (snap) => onCell(snap.key, snap.val())),
            onChildRemoved(cellsRef, (snap) => onCell(snap.key, null)),
            onChildAdded(solvedRef, (snap) => onSolved(snap.key, snap.val())),
            onChildChanged(solvedRef, (snap) => onSolved(snap.key, snap.val())),
            onChildRemoved(solvedRef, (snap) => onSolved(snap.key, null)),
        );
    }

    public dispose(): void {
        for (const detach of this.detachers) {
            detach();
        }
        this.detachers = [];
        this.listeners = [];
    }

    public onChange(listener: StateChangeListener): () => void {
        this.listeners.push(listener);
        return () => {
            this.listeners = this.listeners.filter((candidate) => candidate !== listener);
        };
    }

    private emit(change: StateChange): void {
        for (const listener of this.listeners) {
            listener(change);
        }
    }

    public getLetter(coordinate: Coordinate): string {
        return this.letters.get(cellKey(coordinate)) ?? '';
    }

    public setLetter(coordinate: Coordinate, letter: string): void {
        const key = cellKey(coordinate);
        // Update the mirror first so a getter called before the round trip
        // completes still sees what the player just typed.
        this.letters.set(key, letter);

        const cellRef = ref(this.db, `rooms/${this.options.roomId}/cells/${key}`);
        // Clearing a square removes the record rather than storing "", which
        // keeps the room small and makes "nobody has filled this" unambiguous.
        const write =
            letter === ''
                ? remove(cellRef)
                : set(cellRef, { ch: letter, by: this.uid, at: Date.now() });

        void write.catch((error) => {
            console.error('Failed to sync letter', error);
        });
    }

    public getClueSolved(clueId: number, direction: DirectionKey): boolean {
        return this.solved.get(solvedKey(clueId, direction)) ?? false;
    }

    public setClueSolved(clueId: number, direction: DirectionKey, solved: boolean): void {
        const key = solvedKey(clueId, direction);
        this.solved.set(key, solved);

        const solvedRef = ref(this.db, `rooms/${this.options.roomId}/solved/${key}`);
        const write = solved
            ? set(solvedRef, { v: true, by: this.uid, at: Date.now() })
            : remove(solvedRef);

        void write.catch((error) => {
            console.error('Failed to sync solved marker', error);
        });
    }

    public getCrosswordId(): number | string {
        return this.options.crosswordId;
    }

    /**
     * Serialize to the same shape `LocalStorageContext` produces, so share
     * links keep working from inside a room.
     */
    public getState(): string {
        const input: string[] = [];
        for (let row = 0; row < this.options.rows; ++row) {
            let line = '';
            for (let col = 0; col < this.options.cols; ++col) {
                const letter = this.getLetter({ row, col });
                line += letter === '' ? EMPTY_CHAR : letter;
            }
            input.push(line);
        }

        const solvedString = (direction: DirectionKey, count: number) => {
            let result = '';
            for (let clueId = 1; clueId <= count; ++clueId) {
                result += this.getClueSolved(clueId, direction) ? '1' : '0';
            }
            return result;
        };

        return JSON.stringify({
            input,
            solved_clues: {
                across: solvedString('across', this.options.maxClueAcross + 1),
                down: solvedString('down', this.options.maxClueDown + 1),
            },
            version: '2',
        });
    }

    public getCurrentStorageSource(): StorageSource {
        return StorageSource.Room;
    }

    public getPrimaryStorageSource(): StorageSource {
        return StorageSource.Room;
    }

    /**
     * No-op. The room is already the durable copy — there is no pending
     * in-memory state to flush and nothing local worth backing up over it.
     */
    public forceFlushContext(): void {
        /* nothing to do */
    }

    /** Exposed for tests and for presence, which keys on the player's uid. */
    public getUid(): string {
        return this.uid;
    }
}
