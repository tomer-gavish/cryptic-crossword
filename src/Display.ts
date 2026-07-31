import * as bootstrap from 'bootstrap';
import * as Utils from './Utils';
import { Direction, type Coordinate, type CrosswordPuzzleInfo, type DirectionKey } from './types';
import { LocalStorageContext } from './state/LocalStorageContext';
import {
    StorageSource,
    type ICrosswordState,
    type StateChange,
} from './state/ICrosswordState';
import {
    canCheckWholeSolution,
    hasClueSolutions,
    hasSolutionGrid,
} from './puzzle-capabilities';

declare global {
    interface String {
        replaceAt(index: number, replacement: string): string;
    }
}

String.prototype.replaceAt = function(index, replacement) {
    return this.substring(0, index) + replacement + this.substring(index + replacement.length);
};

interface Config {
    isSolution?: boolean;
    skipContextMenu?: boolean;
    skipStorage?: boolean;
    skipShare?: boolean;
    skipCurrentDef?: boolean;
  }

type IndexdInfo = {
    ids: number[];
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

type ClickContext = {
    activeCoordinate : Coordinate | null,
    previousCoordinate : Coordinate | null,
    direction : Direction
}

enum ClueAction {
    CheckClueCorrectness,
    RevealClueSolution,
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
    private activeContextMenu : bootstrap.Popover | null = null;
    private storageContext : ICrosswordState | null = null;
    private clues: Record<number, ClueData> = {};
    private puzzleInfo : CrosswordPuzzleInfo | null = null;
    private config : Config = {};
    private wordsSeparated = false;
    private puzzleSvg : SVGElement | null = null;

    private readonly TILE_DIMENSIONS = 40;
    private readonly BLOCKED_TILE = '#';

    constructor()
    {
        this.crossword = document.getElementById("crossword")!;
        this.clues_horizontal = document.getElementById("clues_horizontal")!;
        this.clues_vertical = document.getElementById("clues_vertical")!;
        
        document.getElementById("single_menu_link")?.addEventListener('click', this.randomSingle);
    }

    async showCrossword(puzzleInfo: CrosswordPuzzleInfo, config: Config)
    {
        this.clues = {};
        this.puzzleInfo = puzzleInfo;
        this.config = config;

        document.getElementById("title")!.textContent = this.getCrosswordName(puzzleInfo);
        document.getElementById("author")!.textContent = `${puzzleInfo.author}`;
        this.crossword.innerHTML = '';
        this.clues_horizontal.innerHTML = '<h3>מאוזן</h3>';
        this.clues_vertical.innerHTML = '<h3>מאונך</h3>';

        if (!config.skipStorage)
        {
            const getMaxId = (x: { [id: string]: string }) => Math.max(...Object.keys(x).map(id => parseInt(id, 10)));
    
            this.storageContext = new LocalStorageContext(puzzleInfo.id, 
                                                        puzzleInfo.dimensions.rows, 
                                                        puzzleInfo.dimensions.columns,
                                                        getMaxId(puzzleInfo.definitions.across),
                                                        getMaxId(puzzleInfo.definitions.down));
            await this.storageContext.init();
            this.storageContext.onChange((change) => this.handleRemoteChange(change));
        }
        
        this.addKeyListener();
        
        this.puzzleSvg = this.createPuzzleSvg(puzzleInfo, config);
        this.crossword.appendChild(this.puzzleSvg);
        this.crossword.appendChild(this.createDummyInputGrid(puzzleInfo.dimensions.rows, puzzleInfo.dimensions.columns));
        
        this.clues_horizontal.appendChild(this.createClues("across", puzzleInfo));
        this.clues_vertical.appendChild(this.createClues("down", puzzleInfo));

        this.setupCheckSolution(puzzleInfo, config);
        if (!config.skipShare)
        {
            this.setupShareSolution();
        }
        else
        {
            document.getElementById("share_solution_wrapper")?.remove();
        }

        this.setupMoreOptions();
        this.setupCurrentDefMarkSolved();

        this.setTitle(this.getCrosswordName(puzzleInfo));

        document.getElementById("wrapper")!.classList.remove("hide");
        document.getElementById("loader")?.remove();
    }

    async showSingle(puzzleInfo: CrosswordPuzzleInfo, direction: string, defId: string)
    {
        if (!["across", "down"].includes(direction)) 
        {
            throw Error("Invalid direction!");
        }

        if (!hasClueSolutions(puzzleInfo))
        {
            throw Error("No solution for single!");
        }

        const solution = puzzleInfo.solutions[direction as DirectionKey][defId];
        if (typeof (solution) === 'undefined')
        {
            throw Error("Can't find definition!");
        }

        puzzleInfo.dimensions.rows = 1;
        puzzleInfo.dimensions.columns = solution.length;
        puzzleInfo.grid = [Array(puzzleInfo.dimensions.columns).fill("")];
        puzzleInfo.grid[0][solution.length - 1] = "1";
        puzzleInfo.sol_grid = [solution.split('').reverse()];
        puzzleInfo.definitions = {"across": {1: puzzleInfo.definitions[direction as DirectionKey][defId]}, "down": {}};
        puzzleInfo.sol_hash = await Utils.digestMessage(puzzleInfo.sol_grid[0].join(""));

        await this.showCrossword(puzzleInfo, {"skipStorage": true, "skipShare": true, "skipContextMenu": true, "skipCurrentDef": true});
        
        document.getElementById("title")!.textContent = `הגדרה אקראית מתוך ${this.getCrosswordName(puzzleInfo)}`;
        const h3Element = document.querySelector("#clues_horizontal h3");
        if (h3Element)
        {
            h3Element.textContent = "הגדרה";
        }

        const firstButton = document.querySelector('#tabs_header .nav-item:first-child .nav-link');
        if (firstButton)
        {
            firstButton.textContent = "הגדרה";
        }

        this.clues_vertical.innerHTML = '';

        this.setTitle(`הגדרה מתוך ${this.getCrosswordName(puzzleInfo)}`);

        const button = document.createElement("button");
        button.classList.add("btn", "btn-outline-dark", "random_single");
        button.textContent = "עוד הגדרה אקראית";
        button.addEventListener('click', this.randomSingle);
        document.getElementById("check_solution_wrapper")!.appendChild(button);
        document.getElementById("current_definition")!.style.display = "none";
        document.getElementById("more_options")!.style.display = "none";
        document.getElementById("current_definition_mark_solved")!.style.display = "none";

        this.selectDefinitionById(1, Direction.Horizontal);
    }

    private getCrosswordName(puzzleInfo: CrosswordPuzzleInfo) : string
    {
        if (typeof puzzleInfo.name === 'undefined' && typeof puzzleInfo.date === 'undefined') {
            return `תשבץ אינטל ${puzzleInfo.id}`;
        }

        let result = 'תשבץ ';
        if (typeof puzzleInfo.name !== 'undefined') {
            result += puzzleInfo.name;
        }

        if (typeof puzzleInfo.date !== 'undefined') {
            const date = new Date(puzzleInfo.date);
            const formattedDate = `${date.getDate()}/${(date.getMonth() + 1)}/${date.getFullYear()}`;
            result += ` ${formattedDate}`;
        }

        return result;
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

    private setupMoreOptions()
    {
        const moreOptions = <HTMLButtonElement>document.getElementById("more_options");
        if (moreOptions)
        {
            moreOptions.disabled = true;
            const that = this;
            moreOptions.addEventListener("click", function(e){
                const solution = document.getElementById("solution_tab_content");
                if (solution && solution.checkVisibility())
                {
                    return;
                }
                const activeCoords = that.clickContext.activeCoordinate;
                if (activeCoords)
                {
                    that.contextMenu(activeCoords.row, activeCoords.col);
                }
            });
        }
    }

    private setupCurrentDefMarkSolved()
    {
        const currentDefMarkSolved = <HTMLButtonElement>document.getElementById("current_definition_mark_solved");
        if (!currentDefMarkSolved)
        {
            return;
        }

        currentDefMarkSolved.disabled = true;

        if (this.config.skipCurrentDef)
        {
            return;
        }

        const that = this;
        currentDefMarkSolved.addEventListener("click", function(e){

            const firstCoordinate = that.getFirstCoordinateForActiveCoordinate();
            if (firstCoordinate == null)
            {
                return;
            }

            const firstGridElement = that.grid[firstCoordinate.row][firstCoordinate.col];
            if (firstGridElement?.clue_id == null)
            {
                return;
            }

            const checkbox = <HTMLInputElement>document.getElementById(`clue_checkbox_${firstGridElement?.clue_id}_${that.clickContext.direction}`);
            if (!checkbox)
            {
                return;
            }

            checkbox.checked = !checkbox.checked;
            checkbox.dispatchEvent(new Event('change'));
            //currentDefMarkSolved.setAttribute("data-solved", String(checkbox.checked));
        });
    }

    private setupCheckSolution(puzzleInfo: CrosswordPuzzleInfo, config: Config)
    {
        if (!canCheckWholeSolution(puzzleInfo))
        {
            document.getElementById("check_solution_wrapper")!.innerHTML = "";
            document.getElementById("tabs_header")?.classList.add("hide");
        }
        else
        {
            const button = document.createElement("button");
            const that = this;
            button.classList.add("btn", "btn-secondary");
            button.textContent = "בדיקת פתרון";
            const modal = new bootstrap.Modal(document.getElementById("solution_modal")!, {});
            button.addEventListener('click', async (event) => {
                let current_sol = "";
                for (let row = 0; row < puzzleInfo.dimensions.rows; ++row)
                {
                    for (let col = 0; col < puzzleInfo.dimensions.columns; ++col)
                    {
                        current_sol += that.grid[row][col]?.text.textContent || this.BLOCKED_TILE;
                    }
                }

                const current_hash = await Utils.digestMessage(current_sol);
                const modalMessage = document.getElementById("solution_message")!;
                const modalHeader = document.getElementById("solution_modal")!.getElementsByClassName("modal-header")![0];
                if (current_hash === puzzleInfo.sol_hash)
                {
                    modalMessage.innerHTML = "<h4>כל הכבוד!</h4><p>הפתרון שלכם נכון!</p>";
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
            document.getElementById("check_solution_wrapper")!.appendChild(button);

            // Full solution

            if (hasSolutionGrid(puzzleInfo))
            {
                //document.getElementById("fullSolution")?.appendChild(this.createPuzzleSvg(puzzleInfo, true));
                const divElement = document.createElement('div');
                divElement.appendChild(this.createPuzzleSvg(puzzleInfo, {...config, ...{isSolution: true}}));
                document.getElementById("solution_tab_content")?.appendChild(divElement);
            }
        }
    }

    private toggleSeparateWords() {
        // TODO: Refactor this function :-O
        try {
            Object.keys(Direction).forEach(direction => {
                const dir = Direction[direction as keyof typeof Direction];
                const currentDefinitions = this.puzzleInfo!.definitions[dir];
                
                for (const clueId in currentDefinitions) {
                    const id = parseInt(clueId);
                    const coordinate = this.clues[id].coordinate;
                    const clue = currentDefinitions[id];

                    const wordLengthRegex = /\(([\d,\s]+)\)/;
                    const withOtherClueRegex = /עם\s+[\d]+\s*(מאוזן|מאונך)/;
        
                    const match = clue.match(wordLengthRegex);

                    if (match && match[1] && !withOtherClueRegex.test(clue)) {
                        const wordLengths = match[1].split(',').map(Number);
                        if (wordLengths.length > 1) {
                            let offset = 0;
                            wordLengths.slice(0, -1).forEach((len) => {
                                let [x1, y1, x2, y2] = [0, 0, 0, 0];
                                
                                if (dir == Direction.Horizontal) {
                                    x1 = ((coordinate.col + 1 - len - offset) * this.TILE_DIMENSIONS);
                                    y1 = ((coordinate.row) * this.TILE_DIMENSIONS) + 1;
                                    x2 = x1;
                                    y2 = y1 + this.TILE_DIMENSIONS - 2;
                                } else {
                                    y1 = ((coordinate.row + len + offset) * this.TILE_DIMENSIONS);
                                    x1 = ((coordinate.col) * this.TILE_DIMENSIONS) + 1;
                                    y2 = y1;
                                    x2 = x1 + this.TILE_DIMENSIONS - 2;
                                }
                                offset += len;
                                for (let i = 0; i < 5; i++) { // Some browsers show a gray line if this is done only once
                                    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
                                    line.setAttribute("x1", x1.toString());
                                    line.setAttribute("y1", y1.toString());
                                    line.setAttribute("x2", x2.toString());
                                    line.setAttribute("y2", y2.toString());
                                    line.setAttribute("stroke-width", "1");
                                    if (!this.wordsSeparated) {
                                        line.setAttribute("stroke-dasharray", "2");
                                        line.setAttribute("stroke", "white");
                                    }
                                    else {
                                        line.setAttribute("stroke", "black");
                                    }

                                    this.puzzleSvg!.appendChild(line);
                                }
                            });
                        }
                    }
                }
            });

            this.wordsSeparated = !this.wordsSeparated;
        } catch(err) {
            console.log("Error while separating words: ", err);
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
            document.getElementById("share_solution_wrapper")?.classList.add("hide");
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
    
            document.getElementById('share_solution_modal')?.addEventListener('show.bs.modal', (event: Event) => {
                const currentURL = window.location.href;
                const urlWithoutParameters = currentURL.split('?')[0];
                Utils.StringCompressor.compress(that.storageContext!.getState()).then((compressedString: string) => {
                    shareLink.value = `${urlWithoutParameters}?id=${that.storageContext?.getCrosswordId()}` + 
                                      `&${LocalStorageContext.STATE_URL_PARAM}=${encodeURIComponent(compressedString)}`;
                });
                shareLink.setSelectionRange(0, shareLink.value.length);
            }); 
    
            const popoverTriggerList = document.querySelectorAll('[data-bs-toggle="popover"]')
            const popoverList = [...popoverTriggerList].map(popoverTriggerEl => new bootstrap.Popover(popoverTriggerEl));
        }
    }

    private createClues(directionStr: DirectionKey, puzzleInfo: CrosswordPuzzleInfo) : HTMLDListElement
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
            checkbox.id = `clue_checkbox_${int_id}_${direction}`;

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
                } else {
                    dd.classList.remove("solved");
                }
                that.storageContext?.setClueSolved(int_id, directionStr, checkbox.checked);
                const firstCoordinate = that.getFirstCoordinateForActiveCoordinate();
                if (firstCoordinate != null)
                {
                    const firstGridElement = that.grid[firstCoordinate.row][firstCoordinate.col];
                    if ( (firstGridElement?.clue_id == int_id) && (that.clickContext.direction == directionStr))
                    {
                        const currentDefMarkSolved = <HTMLButtonElement>document.getElementById("current_definition_mark_solved");
                        if (currentDefMarkSolved)
                        {
                            currentDefMarkSolved.setAttribute("data-solved", String(checkbox.checked));
                        }
                    }
                }
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

    private createPuzzleSvg(puzzleInfo: CrosswordPuzzleInfo, config: Config) : SVGElement 
    {
        const that = this;
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");

        svg.setAttribute("width", `${this.TILE_DIMENSIONS * puzzleInfo.dimensions.columns}`);
        svg.setAttribute("height", `${this.TILE_DIMENSIONS * puzzleInfo.dimensions.rows}`);

        if (config.isSolution && typeof(puzzleInfo.sol_grid) == "undefined")
        {
            throw new Error("No solution exists");
        }

        if (!config.isSolution)
        {
            this.grid = new Array(puzzleInfo.dimensions.rows);
        }

        for (let row = 0; row < puzzleInfo.dimensions.rows; ++row)
        {
            if (!config.isSolution)
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
                    rect.addEventListener("contextmenu", function(e){e.preventDefault();});
                }
                else 
                {
                    let clue_id = null;
                    if (puzzleInfo.grid[row][col] != "")
                    {
                        const clue_id_elem = document.createElementNS("http://www.w3.org/2000/svg", "text");
                        clue_id_elem.setAttribute("x", `${col * this.TILE_DIMENSIONS + this.TILE_DIMENSIONS - 4}`);
                        clue_id_elem.setAttribute("y", `${row * this.TILE_DIMENSIONS + 12}`);
                        clue_id_elem.classList.add("clue_id_text");
                        clue_id_elem.textContent = puzzleInfo.grid[row][col];
                        group.appendChild(clue_id_elem);

                        clue_id = parseInt(puzzleInfo.grid[row][col]);
                    }

                    const letter_elem = document.createElementNS("http://www.w3.org/2000/svg", "text");
                    letter_elem.setAttribute("x", `${col * this.TILE_DIMENSIONS + (this.TILE_DIMENSIONS / 2)}`);
                    letter_elem.setAttribute("y", `${row * this.TILE_DIMENSIONS + (this.TILE_DIMENSIONS - (this.TILE_DIMENSIONS / 4))}`);
                    letter_elem.setAttribute("text-anchor", "middle");
                    letter_elem.setAttribute("fill", "black");
                    letter_elem.classList.add("letter_elem_text");
                    group.appendChild(letter_elem);
                    gridElement = {rect: rect, text: letter_elem, clue_id: clue_id};
                    
                    if (!config.isSolution)
                    {
                        if (this.storageContext?.getCurrentStorageSource() != StorageSource.UrlParam)
                        {
                            letter_elem.addEventListener("click", function(){that.handleRectClick(row, col);});
                        }

                        if (this.storageContext)
                        {
                            // Render only: this.grid[row][col] is not assigned
                            // until the end of this iteration, and restoring a
                            // saved letter must not be mistaken for an edit.
                            Display.renderLetter(
                                letter_elem, this.storageContext.getLetter({row: row, col: col}));
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

                if (!config.isSolution)
                {
                    this.grid[row][col] = gridElement;
                    if (this.storageContext?.getCurrentStorageSource() != StorageSource.UrlParam)
                    {
                        rect.addEventListener("click", function(){that.handleRectClick(row, col);});
                        if ((!config.skipContextMenu) && (gridElement != null) )
                        {
                            this.attachContextMenu(puzzleInfo, gridElement, row, col);
                        }
                        else
                        {
                            rect.addEventListener("contextmenu", function(e){e.preventDefault();});
                        }
                    }
                }
            }
        }

        if (!config.isSolution)
        {
            const wrapper = document.getElementById("wrapper");
            document.body.addEventListener('click', function(event) {
                if ( (event.target == document.body) || (event.target == wrapper) ) {
                    that.highlightDefinitionByCoordinate(null);
                }
            });
        }

        return svg;
    }

    private attachContextMenu(puzzleInfo: CrosswordPuzzleInfo, gridElement: GridElement, row: number, col: number) {
        const that = this;
        gridElement.rect.addEventListener("contextmenu", function(e){
            e.preventDefault(); 
            that.contextMenu(row, col);
        });

        gridElement.text.addEventListener("contextmenu", function(e){
            e.preventDefault(); 
            e.stopPropagation();
            const clonedEvent = new Event('contextmenu', e);
            gridElement.rect.dispatchEvent(clonedEvent); 
        });

        if (Utils.IsiOS()) 
        {
            Utils.onLongPress(gridElement.rect, function(){
                that.contextMenu(row, col);
            });
            Utils.onLongPress(gridElement.text, function(){
                that.contextMenu(row, col);
            });
        }

        const closePopover = function(){bootstrap.Popover.getInstance(gridElement.rect)?.hide();};

        const closeElement = document.createElement('button');
        closeElement.type = "button";
        closeElement.className = 'btn-close';
        closeElement.setAttribute('aria-hidden', 'true');
        closeElement.addEventListener('click', closePopover);

        const spanElement = document.createElement('span');
        spanElement.textContent = 'אפשרויות';
        spanElement.appendChild(closeElement);

        const divElement = document.createElement('div');
        divElement.className = "context_menu_body";

        const placeholder = document.createElement('div');
        placeholder.className = 'context_menu_placeholder';
        placeholder.id = `context_menu_placeholder_${row}_${col}`;

        const separateWordsElement = document.createElement('button');
        separateWordsElement.type = "button";
        separateWordsElement.className = 'btn btn-secondary';
        separateWordsElement.textContent = "סימון גבולות מילה";
        separateWordsElement.addEventListener('click', function(){
            that.toggleSeparateWords();
            closePopover();
        });
        divElement.appendChild(separateWordsElement);
        
        if (hasClueSolutions(puzzleInfo)) {
            const checkClueElement = document.createElement('button');
            checkClueElement.type = "button";
            checkClueElement.className = 'btn btn-secondary';
            checkClueElement.textContent = "בדיקת נכונות הפתרון";
            checkClueElement.addEventListener('click', function(){
                that.handleContextMenuClueAction(puzzleInfo, placeholder, ClueAction.CheckClueCorrectness);
            });
    
            const revealClueSolution = document.createElement('button');
            revealClueSolution.type = "button";
            revealClueSolution.className = 'btn btn-danger';
            revealClueSolution.textContent = "צפייה בפתרון ההגדרה";
            revealClueSolution.addEventListener('click', function(){
                that.handleContextMenuClueAction(puzzleInfo, placeholder, ClueAction.RevealClueSolution);
            });
            divElement.appendChild(checkClueElement);
            divElement.appendChild(revealClueSolution);
        }

        divElement.appendChild(placeholder);

        const popover = new bootstrap.Popover(gridElement.rect, {
            trigger: 'manual',
            html: true,
            title: spanElement, 
            content: divElement,
            sanitize: false,
            placement: 'bottom',
        });

        

        gridElement.rect.addEventListener('hidden.bs.popover', () => {
            placeholder.innerHTML = '';
        })
    }

    private handleContextMenuClueAction(puzzleInfo: CrosswordPuzzleInfo, targetDiv: Element, action: ClueAction) 
    {
        if (!hasClueSolutions(puzzleInfo))
        {
            return;
        }

        const firstCoordinate = this.getFirstCoordinateForActiveCoordinate();
        if (firstCoordinate == null)
        {
            return;
        }

        const gridElement = this.grid[firstCoordinate.row][firstCoordinate.col];
        if ( (gridElement == null) || (gridElement.clue_id == null) )
        {
            return;
        }

        const expectedSol = puzzleInfo.solutions[this.clickContext.direction][gridElement.clue_id];
        const currentSol = this.getCurrentClueSol(firstCoordinate);
        let res = "";

        if (action == ClueAction.CheckClueCorrectness)
        {
            if (expectedSol == currentSol)
            {
                res = "הפתרון להגדרה <b style='color: green'>נכון</b>!";
            }
            else
            {
                res = "הפתרון להגדרה <b style='color: red'>שגוי</b>!";
            }
        }
        else if (action == ClueAction.RevealClueSolution)
        {
            res = `הפתרון להגדרה הוא: "<b>${expectedSol}</b>"`;
        }

        targetDiv.innerHTML = res;
    }

    private getCurrentClueSol(startCoordinate: Coordinate) : string
    {
        let res = "";
        let coordinate : Coordinate | null = startCoordinate;

        while (coordinate != null) 
        {
            res += this.grid[coordinate.row][coordinate.col]?.text.textContent || "?";
            coordinate = this.nextCoordinate(coordinate);
        }

        return res;
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

    private getFirstCoordinateForActiveCoordinate() : Coordinate | null
    {
        let coordinate = this.clickContext.activeCoordinate;
        if (coordinate == null) 
        {
            return null;
        }

        while (this.prevCoordinate(coordinate) != null) 
        {
            coordinate = this.prevCoordinate(coordinate)!;
        }

        return coordinate;
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
            if (!this.config.skipCurrentDef)
            {
                const currentDefinition = document.getElementById("current_definition");
                if (currentDefinition)
                {
                    currentDefinition.textContent = '[בחרו הגדרה]';
                }

                const moreOptions = <HTMLButtonElement>document.getElementById("more_options");
                if (moreOptions)
                {
                    moreOptions.disabled = true;
                }

                const markSolved = <HTMLButtonElement>document.getElementById("current_definition_mark_solved");
                if (markSolved)
                {
                    markSolved.disabled = true;
                }
            }
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

        if (!this.config.skipCurrentDef)
        {
            const firstCoordinate = this.getFirstCoordinateForActiveCoordinate();
            if (firstCoordinate != null)
            {
                const firstGridElement = this.grid[firstCoordinate.row][firstCoordinate.col];
                if (firstGridElement?.clue_id != null)
                {
                    const clue = this.puzzleInfo?.definitions[this.clickContext.direction][firstGridElement?.clue_id];
                    const currentDefinition = document.getElementById("current_definition");
                    if (clue && currentDefinition)
                    {
                        currentDefinition.textContent = clue;
                        currentDefinition.style.maxWidth = `${this.puzzleSvg!.getAttribute("width")}px`;
                    }

                    const moreOptions = <HTMLButtonElement>document.getElementById("more_options");
                    if (moreOptions)
                    {
                        moreOptions.disabled = false;
                    }

                    const markSolved = <HTMLButtonElement>document.getElementById("current_definition_mark_solved");
                    if (markSolved)
                    {
                        markSolved.disabled = false;
                    }

                    const checkbox = <HTMLInputElement>document.getElementById(`clue_checkbox_${firstGridElement?.clue_id}_${this.clickContext.direction}`);
                    if (checkbox)
                    {
                        markSolved.setAttribute("data-solved", String(checkbox.checked));
                    }
                }
            }
        }
        
        document.getElementById(`dummy_input_r${coordinate.row}_c${coordinate.col}`)?.focus();
    }

    private handleRectClick(row: number, col: number, force_direction: boolean = false) : void
    {
        this.activeContextMenu?.hide();
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

    /** Hebrew final forms are never used in the grid — fold them to the regular form. */
    private static normalizeLetter(letter: string) : string
    {
        const translation: Record<string, string> = {
            'ם': 'מ',
            'ן': 'נ',
            'ף': 'פ',
            'ץ': 'צ',
            'ך': 'כ',
        }
        return letter in translation ? translation[letter] : letter;
    }

    /**
     * Draw a letter into a square's text element. Pure rendering — nothing is
     * persisted, and no coordinate is needed, so this can run during the
     * initial paint before `this.grid` has been populated.
     *
     * The colour is chosen from the letter as typed, before normalization,
     * because only latin letters are marked red and normalization only ever
     * touches Hebrew.
     */
    private static renderLetter(textElement: SVGTextElement, letter: string) : void
    {
        textElement.setAttribute("fill", /^[a-zA-Z]$/.test(letter) ? "red" : "black");
        textElement.textContent = Display.normalizeLetter(letter);
    }

    /** Draw a letter into the square at `coordinate`. Renders only. */
    private paintCell(coordinate: Coordinate, letter: string) : void
    {
        const gridElement = this.grid[coordinate.row]?.[coordinate.col];
        if (gridElement == null)
        {
            return;
        }
        Display.renderLetter(gridElement.text, letter);
    }

    /**
     * Draw a letter AND persist it — the path a local edit takes.
     *
     * The coordinate is explicit. Its predecessor, `setGridText`, took a text
     * element but wrote to `clickContext.activeCoordinate`, so the square it
     * drew and the square it saved were only incidentally the same one; during
     * the initial paint the active coordinate was null and the write silently
     * did nothing. Remote edits have no active coordinate at all, so the
     * coordinate has to travel with the letter.
     */
    private applyLetter(coordinate: Coordinate, letter: string) : void
    {
        this.paintCell(coordinate, letter);
        this.storageContext?.setLetter(coordinate, Display.normalizeLetter(letter));
    }

    /**
     * Apply a change that did not originate in this browser.
     *
     * Nothing produces remote changes yet — `LocalStorageContext` only ever
     * reports the player's own edits. This is the seam the room-backed state
     * implementation plugs into: once it exists, another player's letters
     * arrive here and are drawn by exactly the same code that draws your own.
     */
    private handleRemoteChange(change: StateChange) : void
    {
        if (change.origin !== 'remote')
        {
            // Local edits are already on screen — applyLetter drew them before
            // handing them to the state layer.
            return;
        }

        if (change.kind === 'letter')
        {
            this.paintCell(change.coordinate, change.letter);
            return;
        }

        const checkbox = <HTMLInputElement>document.getElementById(
            `clue_checkbox_${change.clueId}_${change.direction}`);
        if (checkbox && checkbox.checked !== change.solved)
        {
            checkbox.checked = change.solved;
            checkbox.dispatchEvent(new Event('change'));
        }
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

            // The square being edited, captured before the cursor moves on.
            const target = that.clickContext.activeCoordinate;
            const gridElement = that.grid[target.row][target.col];
            if (gridElement == null)
            {
                return;
            }

            if (eventKey.length === 1 && /^[a-z\u0590-\u05FF]$/.test(eventKey))
            {
                that.applyLetter(target, eventKey);
                that.clickContext.activeCoordinate = that.nextCoordinate(target);
                that.highlightDefinitionByCoordinate(that.clickContext.activeCoordinate);
            }
            else if (eventKey === "Backspace")
            {
                that.applyLetter(target, "");
                const prevCoord = that.prevCoordinate(target);
                if (prevCoord != null)
                {
                    that.clickContext.activeCoordinate = prevCoord;
                }
                that.highlightDefinitionByCoordinate(that.clickContext.activeCoordinate);
            }
            else if (eventKey == "Delete")
            {
                that.applyLetter(target, "");
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

    private contextMenu(row: number, col: number) {
        if ( (this.clickContext.activeCoordinate == null) 
                || this.clickContext.activeCoordinate.row != row  
                || this.clickContext.activeCoordinate.col != col)
        {
            this.handleRectClick(row, col);
        }

        const gridElement = this.grid[row][col];
        if (gridElement == null)
        {
            return;
        }

        const popover = bootstrap.Popover.getInstance(gridElement.rect);
        this.activeContextMenu?.hide();
        this.activeContextMenu = popover;
        popover?.toggle();
    }

    private async randomSingle() 
    {
        const indexResponse = await fetch(`index.json`);
        if (!indexResponse.ok) 
        {
            throw new Error("Can't retrieve index");
        }
        const indexJson = await indexResponse.json();
        const max_retry = 7;
        for (let i = 0; i < max_retry; i++)
        {
            try 
            {
                const randomIndex = Utils.randomElement(indexJson.ids);
                let response = await fetch(`crosswords/${randomIndex}.json`);
                if (!response.ok) 
                {
                    continue;
                }
                let json = await response.json();
                if (typeof (json.solutions) === 'undefined')
                {
                    continue;
                }
                const direction = Utils.randomElement(["across", "down"]);
                const defId = Utils.randomElement(Object.keys(json.definitions[direction]));
                const def = json.definitions[direction][defId];
                if (new RegExp("מאוזן|מאונך").test(def)) 
                {
                    continue;
                }
                if (json.solutions[direction][defId].length <= 3)
                {
                    continue;
                }
                window.location.href = `?single=${json.id}.${direction}.${defId}`;
                return;
            } catch(e) {
                console.log('error:', e);
            }
        }
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
            const selectElement = document.getElementById("crossword_select") as HTMLSelectElement;
            
            sortedNumbers.forEach(number => {
                const option = document.createElement("option");
                option.value = String(number);
                option.textContent = `תשבץ #${number}`;
                selectElement.appendChild(option);
            });
        }

        const handleButtonClick = function(): void 
        {
            const selectedCrossword = (document.getElementById("crossword_select") as HTMLSelectElement).value;
            if (selectedCrossword) {
                window.location.href = `?id=${selectedCrossword}`;
            }
        }

        const sortedCrosswordIds = sortNumbers(indexInfo.ids);
        populateSelect(sortedCrosswordIds);

        document.getElementById("choose_crossword")?.addEventListener("click", handleButtonClick);
        document.getElementById("crossword_select")?.addEventListener("change", handleButtonClick);
        document.getElementById("index")!.classList.remove("hide");
        document.getElementById("loader")?.remove();
    }
}