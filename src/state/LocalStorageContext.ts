/**
 * Single-player state, persisted to localStorage.
 *
 * Extracted from Display.ts unchanged apart from implementing `ICrosswordState`
 * and emitting change events. The on-disk format is deliberately untouched:
 * browsers already hold saved progress in it, and `?state=` share links encode
 * exactly this structure.
 */
import * as Utils from '../Utils';
import type { Coordinate, DirectionKey } from '../types';
import {
    StorageSource,
    type ICrosswordState,
    type StateChange,
    type StateChangeListener,
} from './ICrosswordState';

export type StorageContextStruct = {
    input: string[];
    solved_clues: {
        across: string;
        down: string;
    };
    version: string;
};

export class LocalStorageContext implements ICrosswordState {
    private crossword_id: number | string;

    private rows: number;
    private cols: number;

    private num_clues_across: number;
    private num_clues_down: number;

    private context: StorageContextStruct | null = null;
    private local_storage_key: string;

    private current_storage_source = StorageSource.None;

    private listeners: StateChangeListener[] = [];

    private readonly LOCAL_STORAGE_VCN_KEY = 'VCN';
    private readonly LOCAL_STORAGE_VCN_VAL = '1';
    private readonly LOCAL_STORAGE_STRUCT_VERSION = '2';
    private readonly LOCAL_STORAGE_KEY_PREFIX = 'crossword_';
    public static readonly STATE_URL_PARAM = 'state';

    private readonly EMPTY_CHAR = '?';

    constructor(
        crossword_id: number | string,
        rows: number,
        cols: number,
        max_clues_across: number,
        max_clues_down: number,
    ) {
        this.crossword_id = crossword_id;
        this.rows = rows;
        this.cols = cols;
        this.num_clues_across = max_clues_across + 1;
        this.num_clues_down = max_clues_down + 1;

        this.local_storage_key = this.LOCAL_STORAGE_KEY_PREFIX + crossword_id.toString();

        this.localStorageInit();
    }

    public async init() {
        this.context = await this.loadContext();
        console.log(`Solution loaded from ${this.current_storage_source}`);
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

    private localStorageInit() {
        const current_vcn = localStorage.getItem(this.LOCAL_STORAGE_VCN_KEY);

        if (current_vcn != this.LOCAL_STORAGE_VCN_VAL) {
            localStorage.clear();
        }
        localStorage.setItem(this.LOCAL_STORAGE_VCN_KEY, this.LOCAL_STORAGE_VCN_VAL);
    }

    private async loadContext() {
        const urlParams = new URLSearchParams(window.location.search);
        let input = null;

        try {
            if (urlParams.has(LocalStorageContext.STATE_URL_PARAM)) {
                const urlParamValue = urlParams.get(LocalStorageContext.STATE_URL_PARAM);
                if (urlParamValue != null) {
                    input = decodeURIComponent(urlParamValue);
                    input = await Utils.StringCompressor.decompress(input);
                    this.current_storage_source = StorageSource.UrlParam;
                }
            }
        } catch (error) {
            input = null;
        }

        if (input == null) {
            input = localStorage.getItem(this.local_storage_key);
            this.current_storage_source = StorageSource.LocalStorage;
        }

        try {
            if (input == null || input == '') {
                throw new Error('No previous input');
            }

            let context = JSON.parse(input);
            if (Array.isArray(context)) {
                // Migrate from legacy format. Note this is in-memory only —
                // localStorage keeps the legacy blob until the next edit
                // triggers a save.
                context = context.map((innerArray: string[]) =>
                    innerArray.map((str: string) => (str === '' ? this.EMPTY_CHAR : str)).join(''),
                );
                context = this.generateContext(context);
            }
            const input_arr = context['input'];
            if (input_arr.length != this.rows || input_arr[0].length != this.cols) {
                throw new Error('Invalid input');
            }

            if (
                context['solved_clues']['across'].length != this.num_clues_across ||
                context['solved_clues']['down'].length != this.num_clues_down
            ) {
                throw new Error('Invalid input: Solved clues');
            }

            return context;
        } catch (err) {
            this.current_storage_source = StorageSource.None;
            let arr = Array.from({ length: this.rows }, () => this.EMPTY_CHAR.repeat(this.cols));
            return this.generateContext(arr);
        }
    }

    private generateContext(input: string[]): StorageContextStruct {
        return {
            input: input,
            solved_clues: {
                across: '0'.repeat(this.num_clues_across),
                down: '0'.repeat(this.num_clues_down),
            },
            version: this.LOCAL_STORAGE_STRUCT_VERSION,
        };
    }

    public getLetter(coordinate: Coordinate): string {
        if (
            coordinate.row < 0 ||
            coordinate.row >= this.rows ||
            coordinate.col < 0 ||
            coordinate.col >= this.cols
        ) {
            throw new Error('Invalid input for getLetter!');
        }

        const res = this.context!['input'][coordinate.row].charAt(coordinate.col);
        return res == this.EMPTY_CHAR ? '' : res;
    }

    public setLetter(coordinate: Coordinate, letter: string): void {
        if (
            coordinate.row < 0 ||
            coordinate.row >= this.rows ||
            coordinate.col < 0 ||
            coordinate.col >= this.cols ||
            letter.length > 1
        ) {
            throw new Error('Invalid input for setLetter!');
        }

        this.context!['input'][coordinate.row] = this.context!['input'][coordinate.row].replaceAt(
            coordinate.col,
            letter == '' ? this.EMPTY_CHAR : letter,
        );
        localStorage.setItem(this.local_storage_key, JSON.stringify(this.context!));

        this.emit({ kind: 'letter', coordinate, letter, origin: 'local' });
    }

    public setClueSolved(clueId: number, direction: DirectionKey, solved: boolean) {
        this.context!['solved_clues'][direction] = this.context!['solved_clues'][
            direction
        ].replaceAt(clueId - 1, Number(solved).toString());
        localStorage.setItem(this.local_storage_key, JSON.stringify(this.context!));

        this.emit({ kind: 'solved', clueId, direction, solved, origin: 'local' });
    }

    public getClueSolved(clueId: number, direction: DirectionKey): boolean {
        return this.context!['solved_clues'][direction].charAt(clueId - 1) == Number(true).toString();
    }

    public getCrosswordId(): number | string {
        return this.crossword_id;
    }

    public getState(): string {
        return JSON.stringify(this.context);
    }

    public getCurrentStorageSource(): StorageSource {
        return this.current_storage_source;
    }

    public getPrimaryStorageSource(): StorageSource {
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.has(LocalStorageContext.STATE_URL_PARAM)) {
            return StorageSource.UrlParam;
        }

        if (localStorage.hasOwnProperty(this.local_storage_key)) {
            return StorageSource.LocalStorage;
        }

        return StorageSource.None;
    }

    public forceFlushContext() {
        const input = localStorage.getItem(this.local_storage_key);
        if (input != null && input != '') {
            localStorage.setItem(this.local_storage_key + '_backup', input);
        }
        localStorage.setItem(this.local_storage_key, JSON.stringify(this.context!));
    }
}
