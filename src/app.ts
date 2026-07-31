import Display from './Display';
import { EXTERNAL_STORAGE_BASE_URL } from './config';
import type { CrosswordStateFactory } from './state/ICrosswordState';

async function showCrossword(display: Display, idValue: string,
                             createState?: CrosswordStateFactory)
{
    const response = await fetch(`crosswords/${idValue}.json`);
    if (!response.ok)
    {
        throw new Error("Can't retrieve crossword");
    }
    const crossword_json = await response.json();
    await display.showCrossword(crossword_json, createState ? { createState } : {});
}

async function showSingle(display: Display, crosswordId: string,
                          direction: string, defId: string)
{
    const response = await fetch(`crosswords/${crosswordId}.json`);
    if (!response.ok)
    {
        throw new Error("Can't retrieve crossword");
    }
    const crossword_json = await response.json();
    await display.showSingle(crossword_json, direction, defId);
}

async function showIndex(display: Display)
{
    const response = await fetch(`index.json`);
    const json = await response.json()
    display.showIndex(json);
}

/**
 * Build the room-backed state layer, importing the Firebase SDK only now.
 *
 * Solo play must not pay for multiplayer: this dynamic import keeps Firebase
 * in its own webpack chunk, so a player who never opens a `?room=` link never
 * downloads it.
 */
async function roomStateFactory(roomId: string): Promise<CrosswordStateFactory>
{
    const { RoomStorageContext } = await import('./state/RoomStorageContext');
    return (options) => new RoomStorageContext({ ...options, roomId });
}

async function showWebpage()
{
    let display : Display;

    const queryString = window.location.search;
    const externalIdMatch = queryString.match(/id=([0-9a-fA-F-]{32,})/);
    const idMatch = queryString.match(/id=(\d+)(?![0-9a-fA-F-])/);
    const singleMatch = queryString.match(/single=(\d+)\.(across|down)\.(\d+)/);
    // Room ids are push keys: 20 characters of URL-safe randomness.
    const roomMatch = queryString.match(/[?&]room=([A-Za-z0-9_-]{6,})/);
    display = new Display();

    try
    {
        // `?room=` layers on top of whichever crossword is being loaded rather
        // than replacing the route, so it composes with both id forms. It is
        // deliberately ignored for `?single=`, which has no persistent state
        // to share, and it takes precedence over `?state=`: a share snapshot
        // is a frozen view, a room is a live one, and you cannot be in both.
        const createState = roomMatch ? await roomStateFactory(roomMatch[1]) : undefined;

        if (externalIdMatch)
        {
            const externalId = externalIdMatch[1];
            const crosswordUrl = `${EXTERNAL_STORAGE_BASE_URL}/${externalId}.json`;
            const response = await fetch(crosswordUrl);
            const crosswordJson = await response.json();
            await display.showCrossword(crosswordJson, createState ? { createState } : {});
        }
        else if (idMatch)
        {
            await showCrossword(display, idMatch[1], createState);
        }
        else if (singleMatch)
        {
            const [_, crosswordId, direction, defId] = singleMatch;
            await showSingle(display, crosswordId, direction, defId);
        }
        else
        {
            await showIndex(display);
        }
    }
    catch (err)
    {
        console.log(err);
        await showIndex(display);
    }
}

document.addEventListener("DOMContentLoaded", async function() {
    await showWebpage();
});
