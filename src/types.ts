/**
 * Types shared between the display layer and the state layer.
 *
 * These lived inside Display.ts until the state layer was extracted; they moved
 * here so `src/state/` can depend on them without depending on the DOM.
 */

export type Coordinate = {
    row: number;
    col: number;
};

/** The two axes, spelled as they appear in the crossword JSON. */
export type DirectionKey = 'across' | 'down';

export enum Direction {
    Horizontal = 'across',
    Vertical = 'down',
}

export type CrosswordPuzzleInfo = {
    id: number | string;
    name: string | undefined;
    date: Date | undefined;
    author: string;
    dimensions: {
        rows: number;
        columns: number;
    };
    grid: string[][];
    definitions: {
        down: { [id: string]: string };
        across: { [id: string]: string };
    };
    sol_hash: string | undefined;
    sol_grid: string[][] | undefined;
    solutions:
        | {
              down: { [id: string]: string };
              across: { [id: string]: string };
          }
        | undefined;
};
