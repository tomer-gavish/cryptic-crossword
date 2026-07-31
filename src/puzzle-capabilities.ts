/**
 * What a given crossword supports.
 *
 * Not every puzzle ships an answer key, and the ones that do don't all ship the
 * *same* key. Of the 608 bundled crosswords:
 *
 *   603  have `solutions`, `sol_grid` and `sol_hash`
 *     3  have none of them          (144, 478, 610)
 *     2  have `sol_grid` + `sol_hash` but no `solutions`   (353, 477)
 *
 * and every crossword produced by the digitization pipeline looks like the
 * second group, since its exporter emits only
 * `{author, dimensions, grid, definitions, id}`.
 *
 * So these are three genuinely independent capabilities, not one flag: a puzzle
 * can offer a full solution grid while still being unable to check an
 * individual clue. Each feature gates on the data it actually needs — which is
 * why 353 and 477 correctly show the solution tab but omit the per-clue
 * check/reveal actions.
 *
 * Naming the checks (rather than repeating `typeof x === 'undefined'` at each
 * call site) also gives the multiplayer hint logic one thing to ask: a
 * "reveal a letter" hint sourced from the answer key needs
 * `hasClueSolutions`, whereas one sourced from what other players have already
 * typed needs nothing at all.
 */
import type { CrosswordPuzzleInfo } from './types';

/**
 * Each check is a type guard rather than a plain boolean, so that narrowing
 * survives the move out of Display.ts — `hasClueSolutions(p)` has to teach the
 * compiler that `p.solutions` is defined, exactly as the inline
 * `typeof p.solutions === 'undefined'` test used to.
 */
export type PuzzleWithClueSolutions = CrosswordPuzzleInfo & {
    solutions: NonNullable<CrosswordPuzzleInfo['solutions']>;
};

export type PuzzleWithSolutionGrid = CrosswordPuzzleInfo & {
    sol_grid: NonNullable<CrosswordPuzzleInfo['sol_grid']>;
};

export type PuzzleWithSolutionHash = CrosswordPuzzleInfo & { sol_hash: string };

/** Per-clue answers — required to check or reveal a single definition. */
export function hasClueSolutions(
    puzzleInfo: CrosswordPuzzleInfo,
): puzzleInfo is PuzzleWithClueSolutions {
    return typeof puzzleInfo.solutions !== 'undefined';
}

/** A fully filled grid — required to render the solution tab. */
export function hasSolutionGrid(
    puzzleInfo: CrosswordPuzzleInfo,
): puzzleInfo is PuzzleWithSolutionGrid {
    return typeof puzzleInfo.sol_grid !== 'undefined';
}

/** A hash of the completed grid — required to check the puzzle as a whole. */
export function canCheckWholeSolution(
    puzzleInfo: CrosswordPuzzleInfo,
): puzzleInfo is PuzzleWithSolutionHash {
    return typeof puzzleInfo.sol_hash !== 'undefined' && puzzleInfo.sol_hash !== '';
}
