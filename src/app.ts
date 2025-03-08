import Display from './Display';

async function showCrossword(display: Display, idValue: string)
{
    const response = await fetch(`crosswords/${idValue}.json`);
    if (!response.ok) 
    {
        throw new Error("Can't retrieve crossword");
    }
    const crossword_json = await response.json();
    await display.showCrossword(crossword_json, {});
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

// TODO: Move to a different config.js file and import settings
const CONFIG = {
    EXTERNAL_STORAGE_BASE_URL: 'https://storage.googleapis.com/cryptic-crossword/crosswords'
};

async function showWebpage()
{
    let display : Display;

    const queryString = window.location.search;
    const externalIdMatch = queryString.match(/id=([0-9a-fA-F-]{32,})/);
    const idMatch = queryString.match(/id=(\d+)(?![0-9a-fA-F-])/);
    const singleMatch = queryString.match(/single=(\d+)\.(across|down)\.(\d+)/);
    display = new Display();

    try 
    {
        if (externalIdMatch)
        {
            const externalId = externalIdMatch[1];
            const crosswordUrl = `${CONFIG.EXTERNAL_STORAGE_BASE_URL}/${externalId}.json`;
            const response = await fetch(crosswordUrl);
            const crosswordJson = await response.json();
            await display.showCrossword(crosswordJson, {});
        }
        else if (idMatch)
        {
            await showCrossword(display, idMatch[1]);
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