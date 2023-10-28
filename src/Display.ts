import * as bootstrap from 'bootstrap';
import * as Utils from './Utils';

declare global {
    interface String {
        replaceAt(index: number, replacement: string): string;
    }
}

String.prototype.replaceAt = function(index, replacement) {
    return this.substring(0, index) + replacement + this.substring(index + replacement.length);
};

type CrosswordPuzzleInfo = {
    id: number;
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
};

type IndexdInfo = {
    ids: number[];
};

type Coordinate = {
    row: number;
    col: number;
};

type GridElement = {
    rect: SVGRectElement,
    text: SVGTextElement,
    clue_id: number | null
}

type ClueData = {
    coordinate: Coordinate,
    directions: Direction[]
}

enum Direction {
    Horizontal = 1,
    Vertical,
}

type ClickContext = {
    activeCoordinate : Coordinate | null,
    previousCoordinate : Coordinate | null,
    direction : Direction
}

type StorageContextStruct = {
    input : string[],
    solved_clues : {
        "across": string,
        "down": string
    }
    version: string
}

enum StorageSource {
    None = "None",
    UrlParam = "UrlParam",
    LocalStorage = "LocalStorage"
}

class StorageContext
{
    private crossword_id : number;

    private rows : number;
    private cols : number;

    private num_clues_across : number;
    private num_clues_down : number;

    private context : StorageContextStruct | null = null;
    private local_storage_key : string;

    private current_storage_source = StorageSource.None;

    private readonly LOCAL_STORAGE_VCN_KEY = "VCN";
    private readonly LOCAL_STORAGE_VCN_VAL = "1";
    private readonly LOCAL_STORAGE_STRUCT_VERSION = "2";
    private readonly LOCAL_STORAGE_KEY_PREFIX = "crossword_";
    public static readonly STATE_URL_PARAM = "state";

    private readonly EMPTY_CHAR = "?";

    constructor(crossword_id: number, rows: number, cols: number, 
                max_clues_across: number, max_clues_down: number)
    {
        this.crossword_id = crossword_id;
        this.rows = rows;
        this.cols = cols;
        this.num_clues_across = max_clues_across + 1;
        this.num_clues_down = max_clues_down + 1; 
        
        this.local_storage_key = this.LOCAL_STORAGE_KEY_PREFIX + crossword_id.toString();
        
        this.localStorageInit();
    }

    public async init()
    {
        this.context = await this.loadContext();
        console.log(`Solution loaded from ${this.current_storage_source}`)
    }

    private localStorageInit()
    {
        const current_vcn = localStorage.getItem(this.LOCAL_STORAGE_VCN_KEY);
        
        if (current_vcn != this.LOCAL_STORAGE_VCN_VAL)
        {
            localStorage.clear();
        }
        localStorage.setItem(this.LOCAL_STORAGE_VCN_KEY, this.LOCAL_STORAGE_VCN_VAL);
    }

    private async loadContext()
    {
        const urlParams = new URLSearchParams(window.location.search);
        let input = null;

        try
        {
            if (urlParams.has(StorageContext.STATE_URL_PARAM)) 
            {
                const urlParamValue = urlParams.get(StorageContext.STATE_URL_PARAM);
                if (urlParamValue != null)
                {
                    input = decodeURIComponent(urlParamValue);
                    input = await Utils.StringCompressor.decompress(input);
                    this.current_storage_source = StorageSource.UrlParam;
                }
            }
        }
        catch (error)
        {
            input = null;
        }

        if (input == null)
        {
            input = localStorage.getItem(this.local_storage_key);
            this.current_storage_source = StorageSource.LocalStorage;
        }

        try
        {
            if (input == null || input == "")
            {
                throw new Error("No previous input");
            }

            let context = JSON.parse(input);
            if (Array.isArray(context))
            {
                // Migrate from legacy format
                context = context.map((innerArray: string[]) =>
                    innerArray.map((str: string) => str === "" ? this.EMPTY_CHAR : str).join("")
                );
                context = this.generateContext(context);
            }
            const input_arr = context["input"];
            if (input_arr.length != this.rows || input_arr[0].length != this.cols)
            {
                throw new Error("Invalid input");
            }

            if ( 
                (context["solved_clues"]["across"].length != this.num_clues_across)
                ||
                (context["solved_clues"]["down"].length != this.num_clues_down)
            )
            {
                throw new Error("Invalid input: Solved clues");
            }

            return context;
        }
        catch (err)
        {
            this.current_storage_source = StorageSource.None;
            console.log(err);
            let arr = Array.from({ length: this.rows }, () => this.EMPTY_CHAR.repeat(this.cols));
            return this.generateContext(arr);
        }
    }

    private generateContext(input: string[]) : StorageContextStruct {
        return {
            "input": input, 
            "solved_clues": {
                "across": "0".repeat(this.num_clues_across),
                "down": "0".repeat(this.num_clues_down)
            },
            "version": this.LOCAL_STORAGE_STRUCT_VERSION
        };
    }

    public getLetter(coordinate: Coordinate) : string
    {
        if (coordinate.row < 0 || coordinate.row >= this.rows 
            || coordinate.col < 0 || coordinate.col >= this.cols)
        {
            throw new Error("Invalid input for getLetter!");
        }

        const res = this.context!["input"][coordinate.row].charAt(coordinate.col);
        return res == this.EMPTY_CHAR ? "" : res;
    }

    public setLetter(coordinate: Coordinate | null, letter: string) : void
    {
        if (coordinate == null)
        {
            return;
        }

        if (coordinate.row < 0 || coordinate.row >= this.rows 
            || coordinate.col < 0 || coordinate.col >= this.cols || letter.length > 1)
        {
            throw new Error("Invalid input for setLetter!");
        }

        this.context!["input"][coordinate.row] 
            = this.context!["input"][coordinate.row].replaceAt(coordinate.col, letter == "" ? this.EMPTY_CHAR : letter);
        localStorage.setItem(this.local_storage_key, JSON.stringify(this.context!));
    }

    public setClueSolved(clueId: number, direction: "down" | "across", solved: boolean) 
    {
        this.context!["solved_clues"][direction] 
            = this.context!["solved_clues"][direction].replaceAt(clueId - 1, Number(solved).toString());
        localStorage.setItem(this.local_storage_key, JSON.stringify(this.context!));
    }

    public getClueSolved(clueId: number, direction: "down" | "across") : boolean 
    {
        return this.context!["solved_clues"][direction].charAt(clueId - 1) == Number(true).toString();
    }

    public getCrosswordId() : number 
    {
        return this.crossword_id;
    }

    public getState() : string 
    {
        return JSON.stringify(this.context);
    }

    public getCurrentStorageSource() : StorageSource 
    {
        return this.current_storage_source;
    }

    public getPrimaryStorageSource() : StorageSource 
    {
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.has(StorageContext.STATE_URL_PARAM)) 
        {
            return StorageSource.UrlParam;
        }

        if (localStorage.hasOwnProperty(this.local_storage_key))
        {
            return StorageSource.LocalStorage;
        }

        return StorageSource.None;
    }

    public forceFlushContext() 
    {
        const input = localStorage.getItem(this.local_storage_key);
        if (input != null && input != "")
        {
            localStorage.setItem(this.local_storage_key + "_backup", input);
        }
        localStorage.setItem(this.local_storage_key, JSON.stringify(this.context!));
    }
}

export default class Display 
{
    private crossword : Element;
    private clues_horizontal : Element;
    private clues_vertical : Element;
    private grid! : (GridElement | null)[][];
    private clickContext : ClickContext = {
        activeCoordinate : null,
        previousCoordinate : null,
        direction : Direction.Horizontal
    };
    private storageContext : StorageContext | null = null;
    private clues: Record<number, ClueData> = {};

    private readonly TILE_DIMENSIONS = 40;
    private readonly BLOCKED_TILE = '#';

    constructor()
    {
        this.crossword = document.getElementById("crossword")!;
        this.clues_horizontal = document.getElementById("clues_horizontal")!;
        this.clues_vertical = document.getElementById("clues_vertical")!;
    }

    async showCrossword(puzzleInfo: CrosswordPuzzleInfo)
    {
        this.clues = {};

        document.getElementById("title")!.textContent = `תשבץ אינטל ${puzzleInfo.id}`;
        document.getElementById("author")!.textContent = `${puzzleInfo.author}`;
        this.crossword.innerHTML = '';
        this.clues_horizontal.innerHTML = '<h3>מאוזן</h3>';
        this.clues_vertical.innerHTML = '<h3>מאונך</h3>';

        const getMaxId = (x: { [id: string]: string }) => Math.max(...Object.keys(x).map(id => parseInt(id, 10)));

        
        this.storageContext = new StorageContext(puzzleInfo.id, 
                                                    puzzleInfo.dimensions.rows, 
                                                    puzzleInfo.dimensions.columns,
                                                    getMaxId(puzzleInfo.definitions.across),
                                                    getMaxId(puzzleInfo.definitions.down));
        await this.storageContext.init();

        this.addKeyListener();
        
        this.crossword.appendChild(this.createPuzzleSvg(puzzleInfo));
        this.crossword.appendChild(this.createDummyInputGrid(puzzleInfo.dimensions.rows, puzzleInfo.dimensions.columns));

        this.clues_horizontal.appendChild(this.createClues("across", puzzleInfo));
        this.clues_vertical.appendChild(this.createClues("down", puzzleInfo));

        this.setupCheckSolution(puzzleInfo);
        this.setupShareSolution();

        this.setTitle(`תשבץ אינטל ${puzzleInfo.id}`)

        document.getElementById("wrapper")!.classList.remove("hide");
        document.getElementById("loader")?.remove();
    }


    private setTitle(title: string)
    {
        const sep = ' | '
        let newTitle = document.title.substring(document.title.indexOf(sep));
        if (title != "")
        {
            newTitle += sep + title;
        }
        document.title = newTitle;
    }

    private setupCheckSolution(puzzleInfo: CrosswordPuzzleInfo)
    {
        if (typeof (puzzleInfo.sol_hash) === 'undefined' || puzzleInfo.sol_hash == "")
        {
            document.getElementById("checkSolutionWrapper")!.innerHTML = "";
            document.getElementById("tabs_header")?.classList.add("hide");
        }
        else
        {
            // Solution hash

            const digestMessage = async function (message: string) {
                const leftPad = (s: string, c: string, n: number) => c.repeat(n - s.length) + s;
                const msgUint8 = new TextEncoder().encode(message); // encode as (utf-8) Uint8Array
                const hashBuffer = await crypto.subtle.digest("SHA-512", msgUint8); // hash the message
                const hashArray = Array.from(new Uint8Array(hashBuffer)); // convert buffer to byte array
                const hashHex = hashArray
                  .map((b) => leftPad(b.toString(16), "0", 2))
                  .join(""); // convert bytes to hex string
                return hashHex;
              }

            const button = document.createElement("button");
            const that = this;
            button.classList.add("btn", "btn-secondary");
            button.textContent = "בדיקת פתרון";
            const modal = new bootstrap.Modal(document.getElementById("solutionModal")!, {});
            button.addEventListener('click', async (event) => {
                let current_sol = "";
                for (let row = 0; row < puzzleInfo.dimensions.rows; ++row)
                {
                    for (let col = 0; col < puzzleInfo.dimensions.columns; ++col)
                    {
                        current_sol += that.grid[row][col]?.text.textContent || this.BLOCKED_TILE;
                    }
                }

                const current_hash = await digestMessage(current_sol);
                const modalMessage = document.getElementById("solutionMessage")!;
                const modalHeader = document.getElementById("solutionModal")!.getElementsByClassName("modal-header")![0];
                if (current_hash === puzzleInfo.sol_hash)
                {
                    modalMessage.innerHTML = "<h4>כל הכבוד!</h4><p>פתרתם את התשבץ!</p>";
                    modalHeader.classList.add("success");
                    modalHeader.classList.remove("failure");
                }
                else
                {
                    modalMessage.innerHTML = "<h4>לא בדיוק...</h4><p>אתם עדיין לא שם, נסו שוב.</p>";
                    
                    modalHeader.classList.add("failure");
                    modalHeader.classList.remove("success");
                }
                modal.show();
            })
            document.getElementById("checkSolutionWrapper")!.appendChild(button);

            // Full solution

            if (typeof (puzzleInfo.sol_grid) !== 'undefined')
            {
                //document.getElementById("fullSolution")?.appendChild(this.createPuzzleSvg(puzzleInfo, true));
                const divElement = document.createElement('div');
                divElement.appendChild(this.createPuzzleSvg(puzzleInfo, true));
                document.getElementById("solution_tab_content")?.appendChild(divElement);
            }
        }
    }

    private setupShareSolution() {
        const that = this;

        if (this.storageContext?.getCurrentStorageSource() == StorageSource.UrlParam)
        {
            const refresh = () => {
                const currentURL = window.location.href;
                const urlWithoutParameters = currentURL.split('?')[0];
                window.location.href = `${urlWithoutParameters}?id=${that.storageContext?.getCrosswordId()}`;
            };
            document.getElementById("shareSolutionWrapper")?.classList.add("hide");
            document.getElementById("share_actions")?.classList.remove("hide");

            document.getElementById("share_back")?.addEventListener('click', (event: Event) => {
                refresh();
            });

            document.getElementById("share_import")?.addEventListener('click', (event: Event) => {
                that.storageContext?.forceFlushContext();
                refresh();
            });
        }
        else
        {
            if (this.storageContext?.getPrimaryStorageSource() == StorageSource.UrlParam)
            {
                document.getElementById("share_error")?.classList.remove("hide");
            }

            const shareLink = document.getElementById("share_link") as HTMLInputElement;
            if (shareLink == null)
            {
                return;
            }
    
            document.getElementById('share_link_button')?.addEventListener('click', async (event: Event) => {
                await navigator.clipboard.writeText(shareLink.value);
            });
    
            shareLink.addEventListener('click', async (event: Event) => {
                shareLink.setSelectionRange(0, shareLink.value.length);
            });
    
            document.getElementById('shareSolutionModal')?.addEventListener('show.bs.modal', (event: Event) => {
                const currentURL = window.location.href;
                const urlWithoutParameters = currentURL.split('?')[0];
                Utils.StringCompressor.compress(that.storageContext!.getState()).then((compressedString: string) => {
                    shareLink.value = `${urlWithoutParameters}?id=${that.storageContext?.getCrosswordId()}` + 
                                      `&${StorageContext.STATE_URL_PARAM}=${encodeURIComponent(compressedString)}`;
                });
                shareLink.setSelectionRange(0, shareLink.value.length);
            }); 
    
            const popoverTriggerList = document.querySelectorAll('[data-bs-toggle="popover"]')
            const popoverList = [...popoverTriggerList].map(popoverTriggerEl => new bootstrap.Popover(popoverTriggerEl));
        }
    }

    private createClues(directionStr: "across" | "down", puzzleInfo: CrosswordPuzzleInfo) : HTMLDListElement
    {
        const that = this;
        const dl : HTMLDListElement = document.createElement("dl");
        for (const id in puzzleInfo.definitions[directionStr])
        {
            const int_id = parseInt(id);
            const direction : Direction = {"across": Direction.Horizontal, "down": Direction.Vertical}[directionStr];
            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.classList.add("clue_checkbox");

            const dt = document.createElement("dt");
            if (this.storageContext?.getCurrentStorageSource() != StorageSource.UrlParam)
            {
                dt.appendChild(checkbox);
            }
            dt.appendChild(document.createTextNode(`[${id}]`));
            const dd = document.createElement("dd");
            dd.textContent = `${puzzleInfo.definitions[directionStr][id]}`;
            dl.appendChild(dt);
            dl.appendChild(dd);

            dd.addEventListener("click", (event) => {
                that.selectDefinitionById(int_id, direction);
            });
            
            if (that.storageContext?.getClueSolved(int_id, directionStr))
            {
                checkbox.checked = true;
                dd.classList.add("solved");
            }

            checkbox.addEventListener("change", () => {
                if (checkbox.checked) {
                    dd.classList.add("solved");
                    that.storageContext?.setClueSolved(int_id, directionStr, true);
                } else {
                    dd.classList.remove("solved");
                }
                that.storageContext?.setClueSolved(int_id, directionStr, checkbox.checked);
            });


            this.clues[int_id].directions.push(direction);
        }

        return dl;
    }

    private createDummyInputGrid(rows: number, cols: number) {
        const container = document.createElement("div");

        for (let rowIdx = 0; rowIdx < rows; rowIdx++) 
        {
            const row = document.createElement("div");
            row.className = "grid-row";
            
            for (let colIdx = 0; colIdx < cols; colIdx++) 
            {
                const input = document.createElement("input");
                input.type = "text";
                input.className = "dummy_input";
                input.id = `dummy_input_r${rowIdx}_c${colIdx}`;
                row.insertBefore(input, row.firstChild);
            }
            
            container.appendChild(row);
        }

        return container;
    }

    private createPuzzleSvg(puzzleInfo: CrosswordPuzzleInfo, isSolution = false) : SVGElement 
    {
        const that = this;
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");

        svg.setAttribute("width", `${this.TILE_DIMENSIONS * puzzleInfo.dimensions.columns}`);
        svg.setAttribute("height", `${this.TILE_DIMENSIONS * puzzleInfo.dimensions.rows}`);

        if (isSolution && typeof(puzzleInfo.sol_grid) == "undefined")
        {
            throw new Error("No solution exists");
        }

        if (!isSolution)
        {
            this.grid = new Array(puzzleInfo.dimensions.rows);
        }

        for (let row = 0; row < puzzleInfo.dimensions.rows; ++row)
        {
            if (!isSolution)
            {
                this.grid[row] = [];
            }

            for (let col = 0; col < puzzleInfo.dimensions.columns; ++col)
            {
                let gridElement : GridElement | null = null;
                const group = document.createElementNS("http://www.w3.org/2000/svg", "g");

                const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
                rect.setAttribute("x", `${this.TILE_DIMENSIONS * col}`);
                rect.setAttribute("y", `${this.TILE_DIMENSIONS * row}`);
                rect.setAttribute("width", `${this.TILE_DIMENSIONS}`);
                rect.setAttribute("height", `${this.TILE_DIMENSIONS}`);
                rect.setAttribute("stroke", "black");
                rect.setAttribute("stroke-width", "1");
                rect.setAttribute("fill", "white");
                group.appendChild(rect);
                
                if (puzzleInfo.grid[row][col] == this.BLOCKED_TILE)
                {
                    rect.setAttribute("fill", "black");
                }
                else 
                {
                    let clue_id = null;
                    if (puzzleInfo.grid[row][col] != "")
                    {
                        const clue_id_elem = document.createElementNS("http://www.w3.org/2000/svg", "text");
                        clue_id_elem.setAttribute("x", `${col * this.TILE_DIMENSIONS + this.TILE_DIMENSIONS - 4}`);
                        clue_id_elem.setAttribute("y", `${row * this.TILE_DIMENSIONS + 12}`);
                        clue_id_elem.setAttribute("style", "fill: black; font-size: 10px;");
                        clue_id_elem.textContent = puzzleInfo.grid[row][col];
                        group.appendChild(clue_id_elem);

                        clue_id = parseInt(puzzleInfo.grid[row][col]);
                    }

                    const letter_elem = document.createElementNS("http://www.w3.org/2000/svg", "text");
                    letter_elem.setAttribute("x", `${col * this.TILE_DIMENSIONS + (this.TILE_DIMENSIONS / 2)}`);
                    letter_elem.setAttribute("y", `${row * this.TILE_DIMENSIONS + (this.TILE_DIMENSIONS - (this.TILE_DIMENSIONS / 4))}`);
                    letter_elem.setAttribute("text-anchor", "middle");
                    letter_elem.setAttribute("style", "font-size: 30px;");
                    letter_elem.setAttribute("fill", "black");
                    group.appendChild(letter_elem);
                    gridElement = {rect: rect, text: letter_elem, clue_id: clue_id};
                    
                    if (!isSolution)
                    {
                        if (this.storageContext?.getCurrentStorageSource() != StorageSource.UrlParam)
                        {
                            letter_elem.addEventListener("click", function(){that.handleRectClick(row, col);});
                        }

                        if (this.storageContext)
                        {
                            this.setGridText(letter_elem, this.storageContext.getLetter({row: row, col: col}));
                        }

                        if (clue_id != null)
                        {
                            this.clues[clue_id] = {coordinate: {row: row, col: col}, directions: []};
                        }
                    }
                    else
                    {
                        letter_elem.textContent = puzzleInfo.sol_grid![row][col];
                    }
                }
                
                svg.appendChild(group);

                if (!isSolution)
                {
                    this.grid[row][col] = gridElement;
                    if (this.storageContext?.getCurrentStorageSource() != StorageSource.UrlParam)
                    {
                        rect.addEventListener("click", function(){that.handleRectClick(row, col);});
                    }
                }
            }
        }

        return svg;
    }

    private swapDirection() : void
    {
        this.clickContext.direction = (this.clickContext.direction == Direction.Horizontal) 
                                        ? Direction.Vertical : Direction.Horizontal;
    }

    private isCoordFree(coord: Coordinate) : boolean
    {
        if (coord.row < 0 || coord.row >= this.grid.length || coord.col < 0 || coord.col >= this.grid[0].length)
        {
            return false;
        }

        if (this.grid[coord.row][coord.col] == null)
        {
            return false;
        }

        return true;
    }

    private nextCoordinate(coord: Coordinate) : Coordinate | null
    {
        const new_coord = {row: coord.row, col: coord.col};
        if (this.clickContext.direction == Direction.Horizontal)
        {
            new_coord.col -= 1;
        }
        else
        {
            new_coord.row += 1;
        }

        return (this.isCoordFree(new_coord) ? new_coord : null);
    }

    private prevCoordinate(coord: Coordinate) : Coordinate | null
    {
        const new_coord = {row: coord.row, col: coord.col};
        if (this.clickContext.direction == Direction.Horizontal)
        {
            new_coord.col += 1;
        }
        else
        {
            new_coord.row -= 1;
        }

        return (this.isCoordFree(new_coord) ? new_coord : null);
    }

    private selectDefinitionById(id: number, direction: Direction) : void
    {
        const coordinate = this.clues[id].coordinate;
        this.clickContext.direction = direction;

        this.handleRectClick(coordinate.row, coordinate.col, true);
    }

    private highlightDefinitionByCoordinate(coordinate: Coordinate | null) : void 
    {
        let nextCoord : Coordinate | null = null;
        let gridElement : GridElement | null = null;

        document.querySelectorAll("rect.highlighted").forEach(rect => {
            rect.classList.remove("highlighted");
            rect.setAttribute("fill", "white");
        });

        if (coordinate == null)
        {
            return;
        }

        if (this.prevCoordinate(coordinate) == null && this.nextCoordinate(coordinate) == null)
        {
            this.swapDirection();
        }

        for (const func of [this.prevCoordinate, this.nextCoordinate]) 
        {
            nextCoord = {row: coordinate.row, col: coordinate.col};
            do 
            {
                gridElement = this.grid[nextCoord.row][nextCoord.col];
                gridElement?.rect.setAttribute("fill", "#ccffff");
                gridElement?.rect.setAttribute("class", "highlighted");
                nextCoord = func.call(this, nextCoord);
            } while (nextCoord != null);
        }

        gridElement = this.grid[coordinate.row][coordinate.col];

        gridElement?.rect.setAttribute("fill", "#ffffcc");
        gridElement?.rect.setAttribute("class", "highlighted");
        
        document.getElementById(`dummy_input_r${coordinate.row}_c${coordinate.col}`)?.focus();
    }

    private handleRectClick(row: number, col: number, force_direction: boolean = false) : void
    {
        const gridElement = this.grid[row][col];
        if (gridElement == null)
        {
            return;
        }

        this.clickContext.previousCoordinate = this.clickContext.activeCoordinate;
        this.clickContext.activeCoordinate = {row: row, col: col};

        if (!force_direction)
        {
            if (JSON.stringify(this.clickContext.previousCoordinate) == JSON.stringify(this.clickContext.activeCoordinate))
            {
                // User is clicking the same tile to swap directions
                this.swapDirection();
            }
            else if (gridElement.clue_id != null && gridElement.clue_id in this.clues && this.clues[gridElement.clue_id].directions.length == 1)
            {
                // User is clicking a tile which is the beginning of a definition, 
                // assume the purpose is to move in the direction of the definition
                this.clickContext.direction = this.clues[gridElement.clue_id].directions[0];
            }
        }
        // else: Explicit ask for current direction to remain

        this.highlightDefinitionByCoordinate({row: row, col: col});
    }

    private setGridText(textElement: SVGTextElement, letter: string) : void
    {
        const translation: Record<string, string> = {
            'ם': 'מ',
            'ן': 'נ',
            'ף': 'פ',
            'ץ': 'צ',
            'ך': 'כ',
        }
        textElement.setAttribute("fill", /^[a-zA-Z]$/.test(letter) ? "red" : "black");
        if (letter in translation) {
            letter = translation[letter];
        }
        textElement.textContent = letter;
        this.storageContext?.setLetter(this.clickContext.activeCoordinate, letter);
    }

    private addKeyListener()
    {
        const that = this;
        const eventListener = function(event: KeyboardEvent) 
        {
            const inputElement = (event.target as HTMLInputElement);

            if (!inputElement.classList.contains("dummy_input"))
            {
                return;
            }

            let eventKey = event.key;
            if (eventKey == "Unidentified")
            {
                // Android
                eventKey = inputElement.value
            }

            inputElement.value = '';
            if (that.clickContext.activeCoordinate == null)
            {
                return;
            }

            const gridElement = that.grid[that.clickContext.activeCoordinate.row][that.clickContext.activeCoordinate.col];
            if (gridElement == null)
            {
                return;
            }

            if (eventKey.length === 1 && /^[a-z\u0590-\u05FF]$/.test(eventKey)) 
            {
                that.setGridText(gridElement.text, eventKey);
                that.clickContext.activeCoordinate = that.nextCoordinate(that.clickContext.activeCoordinate);
                that.highlightDefinitionByCoordinate(that.clickContext.activeCoordinate);
            }
            else if (eventKey === "Backspace")
            {
                that.setGridText(gridElement.text, "");
                const prevCoord = that.prevCoordinate(that.clickContext.activeCoordinate);
                if (prevCoord != null)
                {
                    that.clickContext.activeCoordinate = prevCoord;
                }
                that.highlightDefinitionByCoordinate(that.clickContext.activeCoordinate);
            }
            else if (eventKey == "Delete")
            {
                that.setGridText(gridElement.text, "");
            }
            event.stopImmediatePropagation();
            
        };

        if (this.storageContext?.getCurrentStorageSource() != StorageSource.UrlParam)
        {
            document.body.addEventListener("keyup", eventListener);
        }

        /*
        Array.from(document.getElementsByClassName("dummy_input")).forEach(
            (element, index, array) => {
                (element as HTMLInputElement).addEventListener("keyup", eventListener);
            }
        );
        */
    }

    public showIndex(indexInfo: IndexdInfo) : void
    {
        this.setTitle("");
        const sortNumbers = function(ids: number[]): number[] 
        {
            return ids.slice().sort((a, b) => b - a);
        }

        const populateSelect = function (sortedNumbers: number[]): void 
        {
            const selectElement = document.getElementById("crosswordSelect") as HTMLSelectElement;
            
            sortedNumbers.forEach(number => {
                const option = document.createElement("option");
                option.value = String(number);
                option.textContent = `תשבץ #${number}`;
                selectElement.appendChild(option);
            });
        }

        const handleButtonClick = function(): void 
        {
            const selectedCrossword = (document.getElementById("crosswordSelect") as HTMLSelectElement).value;
            if (selectedCrossword) {
                window.location.href = `?id=${selectedCrossword}`;
            }
        }

        const sortedCrosswordIds = sortNumbers(indexInfo.ids);
        populateSelect(sortedCrosswordIds);

        document.getElementById("chooseCrossword")?.addEventListener("click", handleButtonClick);
        document.getElementById("crosswordSelect")?.addEventListener("change", handleButtonClick);
        document.getElementById("index")!.classList.remove("hide");
        document.getElementById("loader")?.remove();
    }
}