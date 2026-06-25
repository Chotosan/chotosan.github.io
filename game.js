// --- Cozy Wood Match-3 Game Logic ---

// Spritesheet details: 4 rows, 7 columns (28 tile types)
const TOTAL_TILE_TYPES = 28;
const GEM_TILE_TYPE = 23; // Diamond icon index 23 in the 7x4 spritesheet

// Game State
let state = {
    level: 1,
    score: 0,
    highscore: 0,
    boardTiles: [],    // Tiles currently on the board: { id, type, x, y, z, blocked }
    slotTiles: [],     // Tiles in the bottom slot bar: { id, type, element }
    shelfStacks: [[], [], []], // 3 stacks in the temporary storage shelf (Max height 3 each)
    items: {
        extract: 1,    // Pull 3 tiles from slot to shelf
        undo: 1,       // Undo last move
        shuffle: 1     // Scramble remaining board tiles
    },
    gaugeProgress: 0,  // Purple gem gauge (0 to 100)
    history: [],       // Stack of moves for Undo: { tileId, fromBoard: { x, y, z }, slotIndex }
    gameActive: false,
    audioInitialized: false
};

// Web Audio API Synthesizer
class AudioController {
    constructor() {
        this.ctx = null;
        this.musicNode = null;
        this.musicMuted = localStorage.getItem('musicMuted') === 'true';
        this.sfxMuted = localStorage.getItem('sfxMuted') === 'true';
        this.musicSequenceInterval = null;
    }

    init() {
        if (this.ctx) return;
        try {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            this.ctx = new AudioContextClass();
            state.audioInitialized = true;
            if (!this.musicMuted) {
                this.startMusic();
            }
        } catch (e) {
            console.error("Web Audio API is not supported in this browser", e);
        }
    }

    resume() {
        if (this.ctx && this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
    }

    playTone(freq, type, duration, gainStart, gainEnd = 0, delay = 0) {
        if (this.sfxMuted || !this.ctx) return;
        this.resume();

        const osc = this.ctx.createOscillator();
        const gainNode = this.ctx.createGain();

        osc.type = type;
        osc.frequency.setValueAtTime(freq, this.ctx.currentTime + delay);

        gainNode.gain.setValueAtTime(gainStart, this.ctx.currentTime + delay);
        gainNode.gain.exponentialRampToValueAtTime(Math.max(0.0001, gainEnd), this.ctx.currentTime + delay + duration);

        osc.connect(gainNode);
        gainNode.connect(this.ctx.destination);

        osc.start(this.ctx.currentTime + delay);
        osc.stop(this.ctx.currentTime + delay + duration);
    }

    playTap() {
        // Short organic woody wood-knock sound
        this.playTone(150, 'triangle', 0.08, 0.4, 0.01);
        this.playTone(300, 'sine', 0.04, 0.2, 0.01, 0.01);
    }

    playMatch() {
        // Cheerful ascending major triad chime
        const now = 0;
        this.playTone(523.25, 'sine', 0.15, 0.3, 0.01, now);     // C5
        this.playTone(659.25, 'sine', 0.15, 0.3, 0.01, now + 0.07); // E5
        this.playTone(783.99, 'sine', 0.25, 0.3, 0.01, now + 0.14); // G5
        this.playTone(1046.50, 'sine', 0.3, 0.25, 0.01, now + 0.21); // C6
    }

    playGemMatch() {
        // High-pitched sparkling magic sound
        const now = 0;
        for (let i = 0; i < 6; i++) {
            this.playTone(800 + i * 250, 'sine', 0.12, 0.15, 0.001, now + i * 0.04);
        }
    }

    playItemUse() {
        // Upward whoosh sound
        const now = 0;
        for (let i = 0; i < 10; i++) {
            this.playTone(200 + i * 60, 'triangle', 0.05, 0.1, 0.001, now + i * 0.02);
        }
    }

    playGaugeFull() {
        // Triumphant power-up fanfare
        const now = 0;
        this.playTone(587.33, 'triangle', 0.15, 0.2, 0.01, now); // D5
        this.playTone(587.33, 'triangle', 0.15, 0.2, 0.01, now + 0.1);
        this.playTone(587.33, 'triangle', 0.15, 0.2, 0.01, now + 0.2);
        this.playTone(880.00, 'sine', 0.4, 0.3, 0.01, now + 0.3); // A5
    }

    playWin() {
        // Extended joyful victory melody
        const now = 0;
        const notes = [523, 587, 659, 698, 784, 880, 988, 1047]; // C major scale
        notes.forEach((f, idx) => {
            this.playTone(f, 'sine', 0.18, 0.25, 0.01, now + idx * 0.12);
        });
        this.playTone(1047, 'triangle', 0.5, 0.2, 0.01, now + 0.96);
    }

    playLose() {
        // Sad descending minor chord notes
        const now = 0;
        this.playTone(392, 'sawtooth', 0.25, 0.15, 0.01, now);     // G4
        this.playTone(349, 'sawtooth', 0.25, 0.15, 0.01, now + 0.2); // F4
        this.playTone(311, 'sawtooth', 0.3, 0.15, 0.01, now + 0.4);  // Eb4
        this.playTone(246.94, 'sawtooth', 0.6, 0.2, 0.01, now + 0.6); // B3
    }

    startMusic() {
        if (this.musicMuted || this.musicSequenceInterval) return;
        this.init();
        if (!this.ctx) return;

        // Cozy ambient background chords generator: looping soft chord progressions
        let step = 0;
        const chords = [
            [261.63, 329.63, 392.00], // C major (C4, E4, G4)
            [349.23, 440.00, 523.25], // F major (F4, A4, C5)
            [293.66, 349.23, 440.00], // D minor (D4, F4, A4)
            [392.00, 493.88, 587.33]  // G major (G4, B4, D5)
        ];

        const playChord = () => {
            if (this.musicMuted || !this.ctx) return;
            const currentChord = chords[step % chords.length];
            step++;
            
            // Soft sine wave arpeggio
            currentChord.forEach((f, idx) => {
                this.playTone(f, 'sine', 2.8, 0.06, 0.0001, idx * 0.4);
            });
        };

        playChord();
        this.musicSequenceInterval = setInterval(playChord, 5000);
    }

    stopMusic() {
        if (this.musicSequenceInterval) {
            clearInterval(this.musicSequenceInterval);
            this.musicSequenceInterval = null;
        }
    }

    toggleMusic() {
        this.musicMuted = !this.musicMuted;
        localStorage.setItem('musicMuted', this.musicMuted);
        
        const btn = document.getElementById('btn-music');
        if (this.musicMuted) {
            btn.classList.add('muted');
            this.stopMusic();
        } else {
            btn.classList.remove('muted');
            this.startMusic();
        }
    }

    toggleSfx() {
        this.sfxMuted = !this.sfxMuted;
        localStorage.setItem('sfxMuted', this.sfxMuted);
        
        const btn = document.getElementById('btn-sfx');
        if (this.sfxMuted) {
            btn.classList.add('muted');
        } else {
            btn.classList.remove('muted');
            this.playTap(); // play test sound
        }
    }
}

const audio = new AudioController();

// --- Bounding Box Overlap Math ---
const TILE_WIDTH = 58;
const TILE_HEIGHT = 58; // Make it square to match the square wood frames in new tail1
const COLLISION_BUFFER = 5; // visual overlap tolerance

function areTilesOverlapping(t1, t2) {
    // Return true if t1 overlaps t2 (where overlap means their bounding boxes intersect)
    return Math.abs(t1.x - t2.x) < (TILE_WIDTH - COLLISION_BUFFER) &&
           Math.abs(t1.y - t2.y) < (TILE_HEIGHT - COLLISION_BUFFER);
}

function checkOverlaps() {
    // A tile A is blocked if there exists another tile B such that:
    // 1) B is higher than A (B.z > A.z)
    // 2) B is still on the board (active)
    // 3) B overlaps A horizontally and vertically
    for (let i = 0; i < state.boardTiles.length; i++) {
        let tileA = state.boardTiles[i];
        let isBlocked = false;

        for (let j = 0; j < state.boardTiles.length; j++) {
            let tileB = state.boardTiles[j];
            if (tileB.z > tileA.z && areTilesOverlapping(tileA, tileB)) {
                isBlocked = true;
                break;
            }
        }
        
        tileA.blocked = isBlocked;
        
        // Update DOM element visual representation
        const el = document.getElementById(`tile-${tileA.id}`);
        if (el) {
            if (isBlocked) {
                el.classList.add('blocked');
                el.classList.remove('active');
            } else {
                el.classList.remove('blocked');
                el.classList.add('active');
            }
        }
    }
}

// --- Coordinate Symmetrical Layout Generator ---
function generateLevelLayout(level) {
    const coords = [];
    const boardWidth = 360;
    const boardHeight = 440;
    const centerX = boardWidth / 2 - TILE_WIDTH / 2;
    const centerY = boardHeight / 2 - TILE_HEIGHT / 2;

    // Progression config
    let layersCount = 3;
    let tripletsCount = 8; // 24 tiles base
    if (level === 2) {
        layersCount = 4;
        tripletsCount = 15; // 45 tiles
    } else if (level >= 3) {
        layersCount = Math.min(5, 3 + Math.floor(level / 2));
        tripletsCount = Math.min(24, 8 + (level - 1) * 4); // L3: 16 triplets, L4: 20, L5+: 24
    }
    const totalTiles = tripletsCount * 3;

    let tilesPlaced = 0;
    const gridSpacingX = 62;
    const gridSpacingY = 62; // Square interlocking offsets

    // Generate interlocking grids per layer
    for (let z = 0; z < layersCount && tilesPlaced < totalTiles; z++) {
        const layerMax = Math.ceil((totalTiles - tilesPlaced) / (layersCount - z) / 3) * 3;
        const radius = 3 - Math.min(2, z); // pyramid top is narrower
        const layerCoords = [];
        
        // Offset each layer to create a cozy stacked look (brick-laying style)
        const offsetX = (z % 2) * (gridSpacingX / 2);
        const offsetY = (z % 2) * (gridSpacingY / 2);

        for (let r = -radius; r <= radius; r++) {
            for (let c = 0; c <= radius; c++) {
                if (tilesPlaced + (c === 0 ? 1 : 2) > totalTiles) continue;
                if (layerCoords.length >= layerMax) continue;

                // Diamond mask shape
                if (Math.abs(r) + Math.abs(c) > radius + 1) continue;

                const y = centerY + r * gridSpacingY + offsetY;

                if (c === 0) {
                    const x = centerX + offsetX;
                    layerCoords.push({ x, y, z });
                    tilesPlaced += 1;
                } else {
                    const x1 = centerX + c * gridSpacingX + offsetX;
                    const x2 = centerX - c * gridSpacingX + offsetX;
                    
                    // Keep coordinates within bounds of play area
                    if (x1 >= 0 && x1 <= boardWidth - TILE_WIDTH) {
                        layerCoords.push({ x: x1, y, z });
                        tilesPlaced += 1;
                    }
                    if (tilesPlaced < totalTiles && layerCoords.length < layerMax && x2 >= 0 && x2 <= boardWidth - TILE_WIDTH) {
                        layerCoords.push({ x: x2, y, z });
                        tilesPlaced += 1;
                    }
                }
            }
        }
        coords.push(...layerCoords);
    }

    // Safety fallback: if grid placing didn't produce enough spots, pad them
    let attempts = 0;
    while (coords.length < totalTiles && attempts < 1000) {
        attempts++;
        const z = Math.floor(Math.random() * layersCount);
        const r = Math.floor(Math.random() * 7) - 3;
        const c = Math.floor(Math.random() * 7) - 3;
        const offsetX = (z % 2) * (gridSpacingX / 2);
        const offsetY = (z % 2) * (gridSpacingY / 2);
        const x = centerX + c * gridSpacingX + offsetX;
        const y = centerY + r * gridSpacingY + offsetY;

        if (x >= 0 && x <= boardWidth - TILE_WIDTH && y >= 40 && y <= boardHeight - TILE_HEIGHT - 20) {
            // check duplicate
            if (!coords.some(coord => Math.abs(coord.x - x) < 5 && Math.abs(coord.y - y) < 5 && coord.z === z)) {
                coords.push({ x, y, z });
            }
        }
    }

    // Sort coordinates by z so they render in correct order (bottom first)
    coords.sort((a, b) => a.z - b.z);
    
    // Force coordinates count to be exactly a multiple of 3
    const roundedLength = Math.floor(coords.length / 3) * 3;
    return coords.slice(0, roundedLength);
}

// --- Initialize Level ---
function initLevel(levelNum) {
    state.level = levelNum;
    document.getElementById('level-val').innerText = state.level;

    // Select tile types pool size based on level (more level, more variety)
    // base 6 types, max 20 types
    const numTypesPool = Math.min(20, 5 + Math.floor(state.level * 1.5));
    
    // Choose which types to use from our 30 total icons
    const pool = [];
    while (pool.length < numTypesPool) {
        const type = Math.floor(Math.random() * TOTAL_TILE_TYPES);
        if (!pool.includes(type)) {
            pool.push(type);
        }
    }
    
    // Guarantee Purple Gem (type 25) is in the pool from level 2 onwards, or L1 optionally
    if (state.level >= 2 && !pool.includes(GEM_TILE_TYPE)) {
        pool[Math.floor(Math.random() * pool.length)] = GEM_TILE_TYPE;
    } else if (state.level == 1 && Math.random() < 0.5 && !pool.includes(GEM_TILE_TYPE)) {
        pool.push(GEM_TILE_TYPE);
    }

    // Generate Layout coordinates
    const coords = generateLevelLayout(state.level);
    const totalTiles = coords.length;
    const tripletsCount = totalTiles / 3;

    // Create shuffled array of matching tile types in triplets
    let tileTypes = [];
    for (let i = 0; i < tripletsCount; i++) {
        // Select a type from our pool
        const selectedType = pool[i % pool.length];
        tileTypes.push(selectedType, selectedType, selectedType);
    }
    // Shuffle the type assignments
    shuffleArray(tileTypes);

    // Map coordinates to tiles
    state.boardTiles = coords.map((coord, idx) => ({
        id: idx + 1,
        type: tileTypes[idx],
        x: coord.x,
        y: coord.y,
        z: coord.z,
        blocked: false
    }));

    // Reset Slot, Shelf, and Revives
    state.slotTiles = [];
    state.shelfStacks = [[], [], []];
    state.history = [];
    
    // Clear DOM containers
    document.getElementById('tile-board').innerHTML = '';
    document.getElementById('slot-bar').innerHTML = '';
    renderShelf();
    
    // Render Board Tiles
    renderBoard();

    // Check overlaps to set correct clickable states
    checkOverlaps();
    
    // Update toolbar counts
    updateToolbar();
    
    state.gameActive = true;
}

// --- Shuffle Helper ---
function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
}

// --- Render Board Tiles ---
function renderBoard() {
    const board = document.getElementById('tile-board');
    board.innerHTML = '';

    state.boardTiles.forEach(tile => {
        const tileEl = document.createElement('div');
        tileEl.id = `tile-${tile.id}`;
        tileEl.className = 'tile';
        
        // 3D positioning
        tileEl.style.left = `${tile.x}px`;
        tileEl.style.top = `${tile.y}px`;
        tileEl.style.zIndex = tile.z * 10;
        
        // Slight pop translate based on layer
        tileEl.style.transform = `translate3d(0, -${tile.z * 3}px, 0)`;
        tileEl.style.boxShadow = `
            0 ${4 + tile.z * 1}px 0 var(--color-tile-shadow), 
            0 ${6 + tile.z * 2}px ${10 + tile.z * 2}px rgba(0, 0, 0, 0.35)
        `;

        // Calculate slice coordinates (7 columns, 4 rows)
        const col = tile.type % 7;
        const row = Math.floor(tile.type / 7);
        const xPercent = (col / 6) * 100;
        const yPercent = (row / 3) * 100;

        const isGem = tile.type === GEM_TILE_TYPE;

        tileEl.innerHTML = `
            <div class="tile-inner">
                <div class="tile-icon ${isGem ? 'purple-gem-filter' : ''}" 
                     style="background-position: ${xPercent}% ${yPercent}%;"></div>
            </div>
        `;

        // Tap listener
        tileEl.addEventListener('click', () => {
            if (!tile.blocked && state.gameActive) {
                handleTileTap(tile);
            }
        });

        board.appendChild(tileEl);
    });
}

// --- Render Shelf ---
function renderShelf() {
    const shelf = document.getElementById('temp-shelf');
    shelf.innerHTML = '';

    for (let i = 0; i < 3; i++) {
        const stack = state.shelfStacks[i];
        
        // Create a wrapper for the stack slot
        const slotWrapper = document.createElement('div');
        slotWrapper.className = 'shelf-slot-wrapper';
        
        if (stack.length === 0) {
            const placeholder = document.createElement('div');
            placeholder.className = 'tile-placeholder';
            placeholder.style.width = '100%';
            placeholder.style.height = '100%';
            slotWrapper.appendChild(placeholder);
        } else {
            // Render all tiles in the stack
            stack.forEach((tile, depth) => {
                const tileEl = document.createElement('div');
                tileEl.className = 'tile';
                
                // Only the top tile is active and clickable
                const isTop = (depth === stack.length - 1);
                if (isTop) {
                    tileEl.classList.add('active');
                } else {
                    tileEl.classList.add('stacked-under');
                }
                
                tileEl.id = `shelf-tile-${tile.id}`;
                
                // Stack offsets
                tileEl.style.position = 'absolute';
                tileEl.style.width = '48px';
                tileEl.style.height = '48px';
                tileEl.style.left = '0';
                tileEl.style.top = `${-depth * 6}px`;
                tileEl.style.zIndex = depth + 1;
                
                const col = tile.type % 7;
                const row = Math.floor(tile.type / 7);
                const xPercent = (col / 6) * 100;
                const yPercent = (row / 3) * 100;
                const isGem = tile.type === GEM_TILE_TYPE;
                
                tileEl.innerHTML = `
                    <div class="tile-inner">
                        <div class="tile-icon ${isGem ? 'purple-gem-filter' : ''}" 
                             style="background-position: ${xPercent}% ${yPercent}%;"></div>
                    </div>
                `;
                
                if (isTop) {
                    tileEl.addEventListener('click', () => {
                        if (state.gameActive) {
                            handleShelfTileTap(tile, i);
                        }
                    });
                }
                
                slotWrapper.appendChild(tileEl);
            });
        }
        shelf.appendChild(slotWrapper);
    }
}



// --- Handle Board Tile Tap ---
function handleTileTap(tile) {
    audio.playTap();
    
    // Animate fly to slot
    const tileEl = document.getElementById(`tile-${tile.id}`);
    if (!tileEl) return;

    // Remove from board listing immediately so it doesn't block others
    state.boardTiles = state.boardTiles.filter(t => t.id !== tile.id);
    
    // Check overlaps immediately so lower layer tiles light up as this one flies away
    checkOverlaps();

    // Get fly trajectory positions
    const rect = tileEl.getBoundingClientRect();
    
    // Add flying helper class
    tileEl.classList.add('tile-flying');
    tileEl.style.left = `${rect.left}px`;
    tileEl.style.top = `${rect.top}px`;
    document.body.appendChild(tileEl); // move to body during animation

    // Find destination index in slot (insertion sort by type)
    let destIndex = state.slotTiles.findIndex(t => t.type === tile.type);
    if (destIndex === -1) {
        destIndex = state.slotTiles.length;
    } else {
        // Insert at the end of the existing group
        while (destIndex < state.slotTiles.length && state.slotTiles[destIndex].type === tile.type) {
            destIndex++;
        }
    }

    // Save history for Undo BEFORE we modify slot
    state.history.push({
        tileId: tile.id,
        type: tile.type,
        x: tile.x,
        y: tile.y,
        z: tile.z,
        slotIndex: destIndex,
        shelfIndex: -1
    });

    // Temporarily insert empty item to reserve layout slot
    const placeholderTile = { id: tile.id, type: tile.type, element: tileEl, isPlaceholder: true };
    state.slotTiles.splice(destIndex, 0, placeholderTile);
    
    // Re-draw slot bar immediately to reserve space
    renderSlots();

    // Now fly tile to target slot box
    const targetSlotEl = document.getElementById(`placeholder-${tile.id}`);
    if (targetSlotEl) {
        const targetRect = targetSlotEl.getBoundingClientRect();
        
        // Set styles to fly to destination
        setTimeout(() => {
            tileEl.style.left = `${targetRect.left}px`;
            tileEl.style.top = `${targetRect.top}px`;
            tileEl.style.transform = 'scale(0.8)';
        }, 10);

        // On fly complete
        tileEl.addEventListener('transitionend', function handler() {
            tileEl.removeEventListener('transitionend', handler);
            
            // Replace placeholder with final tile
            placeholderTile.isPlaceholder = false;
            tileEl.remove(); // remove flying element from body
            
            renderSlots();
            checkMatchAndCombo();
            updateToolbar();
        });
    } else {
        // Fallback if slot element not found
        tileEl.remove();
        placeholderTile.isPlaceholder = false;
        renderSlots();
        checkMatchAndCombo();
        updateToolbar();
    }
}

// --- Handle Shelf Tile Tap ---
function handleShelfTileTap(tile, stackIdx) {
    if (state.slotTiles.length >= 7) {
        // Slot is full, can't move back
        return;
    }
    audio.playTap();

    // Remove from shelf stack
    state.shelfStacks[stackIdx].pop();
    renderShelf();

    // Add to slot with insertion sort
    let destIndex = state.slotTiles.findIndex(t => t.type === tile.type);
    if (destIndex === -1) {
        destIndex = state.slotTiles.length;
    } else {
        while (destIndex < state.slotTiles.length && state.slotTiles[destIndex].type === tile.type) {
            destIndex++;
        }
    }

    // Save history for Undo
    state.history.push({
        tileId: tile.id,
        type: tile.type,
        x: -1, // wasn't on board
        y: -1,
        z: -1,
        slotIndex: destIndex,
        shelfIndex: stackIdx // original shelf index
    });

    state.slotTiles.splice(destIndex, 0, { id: tile.id, type: tile.type, element: null });
    renderSlots();
    checkMatchAndCombo();
    updateToolbar();
}

// --- Render Slot Bar ---
function renderSlots() {
    const bar = document.getElementById('slot-bar');
    bar.innerHTML = '';

    state.slotTiles.forEach(tile => {
        const tileEl = document.createElement('div');
        tileEl.className = 'tile';
        if (tile.isPlaceholder) {
            tileEl.style.opacity = '0';
            tileEl.id = `placeholder-${tile.id}`;
        }

        const col = tile.type % 7;
        const row = Math.floor(tile.type / 7);
        const xPercent = (col / 6) * 100;
        const yPercent = (row / 3) * 100;
        const isGem = tile.type === GEM_TILE_TYPE;

        tileEl.innerHTML = `
            <div class="tile-inner">
                <div class="tile-icon ${isGem ? 'purple-gem-filter' : ''}" 
                     style="background-position: ${xPercent}% ${yPercent}%;"></div>
            </div>
        `;
        bar.appendChild(tileEl);
    });
}

// --- Matching check ---
function checkMatchAndCombo() {
    // Look for 3 consecutive identical tile types in the slot bar
    let matchFound = false;
    let matchType = -1;
    let matchIndex = -1;

    for (let i = 0; i <= state.slotTiles.length - 3; i++) {
        if (state.slotTiles[i].type === state.slotTiles[i+1].type &&
            state.slotTiles[i].type === state.slotTiles[i+2].type &&
            !state.slotTiles[i].isPlaceholder &&
            !state.slotTiles[i+1].isPlaceholder &&
            !state.slotTiles[i+2].isPlaceholder) {
            
            matchFound = true;
            matchType = state.slotTiles[i].type;
            matchIndex = i;
            break;
        }
    }

    if (matchFound) {
        // Match chime
        if (matchType === GEM_TILE_TYPE) {
            audio.playGemMatch();
            // Increase gauge
            state.gaugeProgress += 33.4; // 3 matches will hit 100%
            if (state.gaugeProgress >= 99.9) {
                state.gaugeProgress = 0;
                rewardRandomItem();
            }
            updateGauge();
        } else {
            audio.playMatch();
        }

        // Capture the matched IDs before they are spliced from the list
        const matchedIds = [
            state.slotTiles[matchIndex].id,
            state.slotTiles[matchIndex + 1].id,
            state.slotTiles[matchIndex + 2].id
        ];

        // Get matched slot tile elements to run fade/shrink animations
        const slotElements = document.querySelectorAll('#slot-bar .tile');
        const m1 = slotElements[matchIndex];
        const m2 = slotElements[matchIndex + 1];
        const m3 = slotElements[matchIndex + 2];

        [m1, m2, m3].forEach(el => {
            if (el) {
                el.style.transform = 'scale(0)';
                el.style.opacity = '0';
            }
        });

        // Trigger particle explosion effect
        if (m2) {
            const rect = m2.getBoundingClientRect();
            createParticles(rect.left + rect.width / 2, rect.top + rect.height / 2, matchType === GEM_TILE_TYPE ? 'purple' : 'gold');
        }

        // Delay updating list so animations play out
        setTimeout(() => {
            // Remove matched tiles from array using unique IDs to avoid index-shifting race conditions
            state.slotTiles = state.slotTiles.filter(t => !matchedIds.includes(t.id));
            
            // Clear history items that referenced these removed elements since they can no longer be undone
            state.history = state.history.filter(h => !matchedIds.includes(h.tileId));

            state.score += 15;
            document.getElementById('score-val').innerText = state.score;
            if (state.score > state.highscore) {
                state.highscore = state.score;
                document.getElementById('highscore-val').innerText = state.highscore;
                localStorage.setItem('highscore', state.highscore);
            }

            renderSlots();
            updateToolbar();
            checkGameStatus();
        }, 150);
    } else {
        checkGameStatus();
    }
}

// --- Check Win / Lose Status ---
function checkGameStatus() {
    // Win Condition: board, slot, and shelf are all empty
    if (state.boardTiles.length === 0 && state.slotTiles.length === 0 && state.shelfStacks.every(stack => stack.length === 0)) {
        state.gameActive = false;
        audio.playWin();
        
        // Show level clear overlay
        document.getElementById('victory-score').innerText = state.score;
        document.getElementById('victory-level').innerText = state.level;
        document.getElementById('victory-modal').classList.remove('hidden');
    }
    // Lose Condition: slots filled to 7
    else if (state.slotTiles.length >= 7) {
        // Verify that there are indeed no placeholders still flying
        const anyFlying = state.slotTiles.some(t => t.isPlaceholder);
        if (!anyFlying) {
            state.gameActive = false;
            audio.playLose();
            
            // Show game over overlay
            document.getElementById('gameover-score').innerText = state.score;
            document.getElementById('gameover-level').innerText = state.level;
            document.getElementById('gameover-modal').classList.remove('hidden');
        }
    }
}

// --- Gauge Progress UI Update ---
function updateGauge() {
    const fill = document.getElementById('purple-gauge');
    fill.style.width = `${Math.min(100, state.gaugeProgress)}%`;
}

// --- Particle Match Explode Effect ---
function createParticles(x, y, colorTheme) {
    const container = document.body;
    const colors = colorTheme === 'purple' 
        ? ['#c084fc', '#a855f7', '#d8b4fe', '#f3e8ff', '#ffffff'] 
        : ['#fbbf24', '#f59e0b', '#fef08a', '#fffbeb', '#a16207'];

    for (let i = 0; i < 15; i++) {
        const p = document.createElement('div');
        p.className = 'particle';
        p.style.left = `${x}px`;
        p.style.top = `${y}px`;
        
        const size = Math.random() * 6 + 4;
        p.style.width = `${size}px`;
        p.style.height = `${size}px`;
        p.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
        
        // Explosive vectors
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 80 + 30;
        const dx = Math.cos(angle) * speed;
        const dy = Math.sin(angle) * speed;

        p.style.setProperty('--dx', `${dx}px`);
        p.style.setProperty('--dy', `${dy}px`);

        container.appendChild(p);

        // remove after animation
        p.addEventListener('animationend', () => p.remove());
    }
}

// --- Reward Random Item ---
function rewardRandomItem() {
    audio.playGaugeFull();
    const itemKeys = ['extract', 'undo', 'shuffle'];
    const rewardedKey = itemKeys[Math.floor(Math.random() * itemKeys.length)];
    state.items[rewardedKey]++;
    updateToolbar();
    
    // Visual glow alert on the rewarded button
    const btnId = `btn-${rewardedKey}`;
    const btn = document.getElementById(btnId);
    if (btn) {
        btn.style.transform = 'scale(1.15)';
        setTimeout(() => {
            btn.style.transform = '';
        }, 300);
    }
}

// --- Update Toolbar Button Enabled / Counts ---
function updateToolbar() {
    // Update count badges
    document.getElementById('count-extract').innerText = state.items.extract;
    document.getElementById('count-undo').innerText = state.items.undo;
    document.getElementById('count-shuffle').innerText = state.items.shuffle;

    // Enable/Disable buttons based on counts and validity
    
    // Extract: needs item count > 0, slot tiles >= 1, shelf has empty space in at least one stack
    const canExtract = state.items.extract > 0 && state.slotTiles.length >= 1 && state.shelfStacks.some(stack => stack.length < 3) && state.gameActive;
    document.getElementById('btn-extract').disabled = !canExtract;

    // Undo: needs item count > 0, history has records, slot has tiles, game is active
    const canUndo = state.items.undo > 0 && state.history.length > 0 && state.slotTiles.length >= 1 && state.gameActive;
    document.getElementById('btn-undo').disabled = !canUndo;

    // Shuffle: needs item count > 0, board has tiles, game is active
    const canShuffle = state.items.shuffle > 0 && state.boardTiles.length >= 1 && state.gameActive;
    document.getElementById('btn-shuffle').disabled = !canShuffle;
}

// --- Item Actions Implementation ---

// 1. Extract Item (템 꺼내기)
function useExtract() {
    if (state.items.extract <= 0 || state.slotTiles.length === 0) return;
    
    // Find total available spaces across all stacks (max height is 3 each)
    let totalSpace = 0;
    state.shelfStacks.forEach(stack => {
        totalSpace += (3 - stack.length);
    });
    
    if (totalSpace === 0) return; // No space on shelf
    
    audio.playItemUse();
    state.items.extract--;
    
    // Take the last 3 tiles (or fewer if slot holds less or space is less)
    const extractCount = Math.min(3, totalSpace, state.slotTiles.length);
    
    for (let i = 0; i < extractCount; i++) {
        const popped = state.slotTiles.pop();
        
        // Find the stack with the minimum height that is < 3 to distribute evenly
        let minHeight = 4;
        let targetIdx = -1;
        for (let j = 0; j < 3; j++) {
            if (state.shelfStacks[j].length < 3 && state.shelfStacks[j].length < minHeight) {
                minHeight = state.shelfStacks[j].length;
                targetIdx = j;
            }
        }
        
        if (targetIdx !== -1) {
            state.shelfStacks[targetIdx].push({
                id: popped.id,
                type: popped.type
            });
        }
    }

    // Clear history stack because layout order changed (can't cleanly undo previous click)
    state.history = [];

    renderSlots();
    renderShelf();
    updateToolbar();
}

// 2. Undo Item (직전 취소)
function useUndo() {
    if (state.items.undo <= 0 || state.history.length === 0) return;
    audio.playItemUse();
    state.items.undo--;

    const lastMove = state.history.pop();
    
    // Find the index of the undone tile in the slot by its unique ID
    const indexToRemove = state.slotTiles.findIndex(t => t.id === lastMove.tileId);
    
    if (lastMove.x !== -1) {
        // Returned to board
        // Remove from slot
        if (indexToRemove !== -1) {
            state.slotTiles.splice(indexToRemove, 1);
        }
        
        // Restore to board list
        state.boardTiles.push({
            id: lastMove.tileId,
            type: lastMove.type,
            x: lastMove.x,
            y: lastMove.y,
            z: lastMove.z,
            blocked: false
        });
        
        // Sort board tiles so z-stacking renders correctly
        state.boardTiles.sort((a, b) => a.z - b.z);
        
        renderBoard();
        checkOverlaps();
    } else {
        // Returned to shelf from slot
        if (indexToRemove !== -1) {
            state.slotTiles.splice(indexToRemove, 1);
        }
        
        // Push back into the stack it came from
        state.shelfStacks[lastMove.shelfIndex].push({
            id: lastMove.tileId,
            type: lastMove.type
        });
        
        renderShelf();
    }

    renderSlots();
    updateToolbar();
}

// 3. Shuffle Item (타일 섞기)
function useShuffle() {
    if (state.items.shuffle <= 0 || state.boardTiles.length === 0) return;
    audio.playItemUse();
    state.items.shuffle--;

    // Keep coordinates fixed, but collect and shuffle all tile types
    const types = state.boardTiles.map(t => t.type);
    shuffleArray(types);

    state.boardTiles.forEach((tile, idx) => {
        tile.type = types[idx];
    });

    // Re-render
    renderBoard();
    checkOverlaps();
    updateToolbar();
}

// --- Shop Modal & Ad Simulation Logic ---

function openShop() {
    audio.playTap();
    document.getElementById('shop-modal').classList.remove('hidden');
}

function closeShop() {
    audio.playTap();
    document.getElementById('shop-modal').classList.add('hidden');
}

function startSimulatedAd(durationMs, callback) {
    // Show ad overlay
    const modal = document.getElementById('ad-modal');
    const timerText = document.getElementById('ad-timer');
    const fill = document.getElementById('ad-progress-fill');
    
    modal.classList.remove('hidden');
    fill.style.transition = 'none';
    fill.style.width = '0%';
    
    let secondsLeft = Math.ceil(durationMs / 1000);
    timerText.innerText = `${secondsLeft}s`;
    
    // Animate progress fill
    setTimeout(() => {
        fill.style.transition = `width ${durationMs}ms linear`;
        fill.style.width = '100%';
    }, 50);
    
    const interval = setInterval(() => {
        secondsLeft--;
        if (secondsLeft > 0) {
            timerText.innerText = `${secondsLeft}s`;
            audio.playTone(400, 'sine', 0.05, 0.05); // ad ticker sound
        } else {
            clearInterval(interval);
        }
    }, 1000);
    
    setTimeout(() => {
        clearInterval(interval);
        modal.classList.add('hidden');
        callback();
    }, durationMs);
}

function watchAdForItem(itemKey) {
    audio.playTap();
    closeShop();
    
    // Start 3-second simulated ad
    startSimulatedAd(3000, () => {
        state.items[itemKey]++;
        updateToolbar();
        audio.playGaugeFull(); // pleasant chime reward
        
        // Reopen shop so they can watch more ads if they want
        openShop();
    });
}

function triggerReviveAd() {
    audio.playTap();
    document.getElementById('gameover-modal').classList.add('hidden');
    
    // Start 3-second simulated ad
    startSimulatedAd(3000, () => {
        reviveGame();
    });
}

function reviveGame() {
    // Take the last 3 tiles from the slot bar to move to the board
    const activeSlotTiles = state.slotTiles.filter(t => !t.isPlaceholder);
    const tilesToMove = activeSlotTiles.slice(-3);
    const matchedIds = tilesToMove.map(t => t.id);
    
    // Remove these 3 tiles from slot bar
    state.slotTiles = state.slotTiles.filter(t => !matchedIds.includes(t.id));
    
    if (tilesToMove.length > 0) {
        // Find max ID and max Z on the board to avoid conflicts
        let maxId = state.boardTiles.reduce((max, tile) => Math.max(max, tile.id), 0);
        let maxZ = state.boardTiles.reduce((max, tile) => Math.max(max, tile.z), 0);
        
        // Lay them out at the bottom of the board (y = 350 to prevent clipping, z = maxZ + 1)
        // Align horizontally, centered on the board (width = 360)
        const N = tilesToMove.length;
        const spacing = 48; // slight overlap
        const totalWidth = (N - 1) * spacing + TILE_WIDTH;
        const startX = (360 - totalWidth) / 2;
        
        tilesToMove.forEach((tile, index) => {
            maxId++;
            state.boardTiles.push({
                id: maxId,
                type: tile.type,
                x: startX + index * spacing,
                y: 350,
                z: maxZ + 1,
                blocked: false
            });
        });
    }
    
    // Clear history stack
    state.history = [];
    
    // Re-render board and slot bar
    renderBoard();
    renderSlots();
    
    // Restore game playability
    state.gameActive = true;
    checkOverlaps();
    updateToolbar();
    
    audio.playGaugeFull(); // pleasant chime on resume
}

// --- Setup User Controls & Event Listeners ---
function setupEventListeners() {
    // Sound Toggles
    document.getElementById('btn-music').addEventListener('click', (e) => {
        e.stopPropagation();
        audio.toggleMusic();
    });

    document.getElementById('btn-sfx').addEventListener('click', (e) => {
        e.stopPropagation();
        audio.toggleSfx();
    });

    // Start modal button
    document.getElementById('btn-start').addEventListener('click', () => {
        audio.init();
        document.getElementById('start-modal').classList.add('hidden');
        initLevel(1);
    });

    // Next Level button
    document.getElementById('btn-next-level').addEventListener('click', () => {
        audio.init();
        document.getElementById('victory-modal').classList.add('hidden');
        initLevel(state.level + 1);
    });

    // Restart button
    document.getElementById('btn-restart').addEventListener('click', () => {
        audio.init();
        document.getElementById('gameover-modal').classList.add('hidden');
        // Reset score
        state.score = 0;
        document.getElementById('score-val').innerText = '0';
        initLevel(1);
    });

    // Toolbar buttons
    document.getElementById('btn-extract').addEventListener('click', useExtract);
    document.getElementById('btn-undo').addEventListener('click', useUndo);
    document.getElementById('btn-shuffle').addEventListener('click', useShuffle);

    // Shop buttons
    document.getElementById('btn-shop').addEventListener('click', openShop);
    document.getElementById('btn-close-shop').addEventListener('click', closeShop);
    
    document.getElementById('btn-shop-extract').addEventListener('click', () => watchAdForItem('extract'));
    document.getElementById('btn-shop-undo').addEventListener('click', () => watchAdForItem('undo'));
    document.getElementById('btn-shop-shuffle').addEventListener('click', () => watchAdForItem('shuffle'));
    
    // Revive ad button
    document.getElementById('btn-revive-ad').addEventListener('click', triggerReviveAd);

    // Click anywhere on body initializes Web Audio Context (browser rule compliance)
    document.body.addEventListener('click', () => {
        audio.init();
    }, { once: true });
}

// --- Load High Score ---
function loadHighScore() {
    const saved = localStorage.getItem('highscore');
    if (saved) {
        state.highscore = parseInt(saved, 10);
        document.getElementById('highscore-val').innerText = state.highscore;
    }
}

// --- Initializing App ---
window.addEventListener('DOMContentLoaded', () => {
    loadHighScore();
    setupEventListeners();
    
    // Sync UI mute buttons to local storage values
    if (audio.musicMuted) document.getElementById('btn-music').classList.add('muted');
    if (audio.sfxMuted) document.getElementById('btn-sfx').classList.add('muted');
});
