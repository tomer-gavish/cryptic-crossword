/**
 * The solver's state abstraction.
 *
 * Everything the UI knows about a player's progress goes through this
 * interface. `LocalStorageContext` is the single-player implementation; a
 * room-backed implementation will sit alongside it for multiplayer, and the
 * display layer should not be able to tell them apart.
 *
 * The one addition over what the original `StorageContext` offered is
 * `onChange`. Locally, state only ever changes because the player just did
 * something, so nothing needed to listen. Once state can also change because
 * *somebody else* did something, the UI needs a way to hear about it.
 */
import type { Coordinate, DirectionKey } from '../types';

/** Where the current state was loaded from. */
export enum StorageSource {
    None = 'None',
    UrlParam = 'UrlParam',
    LocalStorage = 'LocalStorage',
}

/**
 * Who caused a change.
 *
 * `local` means this browser did it — the display has usually already drawn it
 * by the time the event fires. `remote` means another player did, and the
 * display has not seen it yet.
 */
export type ChangeOrigin = 'local' | 'remote';

export type LetterChange = {
    kind: 'letter';
    coordinate: Coordinate;
    letter: string;
    origin: ChangeOrigin;
};

export type SolvedChange = {
    kind: 'solved';
    clueId: number;
    direction: DirectionKey;
    solved: boolean;
    origin: ChangeOrigin;
};

export type StateChange = LetterChange | SolvedChange;

export type StateChangeListener = (change: StateChange) => void;

export interface ICrosswordState {
    /** Load any previously saved progress. Must be awaited before use. */
    init(): Promise<void>;

    getLetter(coordinate: Coordinate): string;
    setLetter(coordinate: Coordinate, letter: string): void;

    getClueSolved(clueId: number, direction: DirectionKey): boolean;
    setClueSolved(clueId: number, direction: DirectionKey, solved: boolean): void;

    getCrosswordId(): number | string;

    /** The whole state, serialized — used to build share links. */
    getState(): string;

    getCurrentStorageSource(): StorageSource;
    getPrimaryStorageSource(): StorageSource;

    /** Persist the in-memory state, backing up whatever it replaces. */
    forceFlushContext(): void;

    /** Subscribe to state changes. Returns an unsubscribe function. */
    onChange(listener: StateChangeListener): () => void;
}
