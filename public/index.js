// Game state
let currentUser = '';
let currentGameId = '';
let boardSize = 50;
let board = [];
let isInGame = false;
let socket = null;

// Camera and viewport state
let viewportSize = 15; // Must be odd number for centered cursor
let cameraX = 0; // Camera position in tile coordinates
let cameraY = 0;
let cursorX = 0; // Cursor position in tile coordinates
let cursorY = 0;
let tileSize = 0; // Will be calculated based on canvas size and viewport

// Smooth scrolling state
let targetCameraX = 0;
let targetCameraY = 0;
let scrollSpeed = 0.15; // How fast to interpolate (0-1, higher = faster)
let isScrolling = false;
let animationFrameId = null;

// Game list refresh state
let gameListRefreshId = null;
let lastGameListRefresh = 0;
const GAME_LIST_REFRESH_INTERVAL = 5000; // 5 seconds in milliseconds

// Tile colors
const TILE_COLORS = {
    0: {
        light: '#ecf0f1',
        dark: '#bdc3c7'
    },
    1: {
        light: '#3498db',
        dark: '#2980b9'
    }
}

// DOM elements
const lobbyScreen = document.getElementById('lobbyScreen');
const gameScreen = document.getElementById('gameScreen');
const hostUsernameInput = document.getElementById('hostUsername');
const playerUsernameInput = document.getElementById('playerUsername');
const boardSizeInput = document.getElementById('boardSize');
const gamesList = document.getElementById('gamesList');
const boardCanvas = document.getElementById('board');
const gameTitle = document.getElementById('gameTitle');
const playersInfo = document.getElementById('playersInfo');
const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const waitingOverlay = document.getElementById('waitingOverlay');

// Canvas
const c = boardCanvas.getContext('2d');

// Game state
let isHost = false;
let currentGame = null;

// Game list refresh loop using requestAnimationFrame
function gameListRefreshLoop(timestamp) {
    if (!isInGame) {
        // Check if enough time has passed since last refresh
        if (timestamp - lastGameListRefresh >= GAME_LIST_REFRESH_INTERVAL) {
            requestGamesList();
            lastGameListRefresh = timestamp;
        }
        
        // Continue the loop
        gameListRefreshId = requestAnimationFrame(gameListRefreshLoop);
    }
}

// Start game list refresh loop
function startGameListRefresh() {
    if (!gameListRefreshId) {
        lastGameListRefresh = performance.now();
        gameListRefreshId = requestAnimationFrame(gameListRefreshLoop);
    }
}

// Stop game list refresh loop
function stopGameListRefresh() {
    if (gameListRefreshId) {
        cancelAnimationFrame(gameListRefreshId);
        gameListRefreshId = null;
    }
}

// Initialize socket connection
function initializeSocket() {
    socket = io();
    
    // Socket event listeners
    socket.on('connect', () => {
        console.log('Connected to server');
        requestGamesList();
    });
    
    socket.on('game-created', (data) => {
        currentGameId = data.gameId;
        currentGame = data.game;
        showGameScreen(data.game);
    });
    
    socket.on('game-joined', (data) => {
        currentGame = data.game;
        showGameScreen(data.game);
    });
    
    socket.on('game-list', (gameList) => {
        updateGamesList(gameList);
    });
    
    socket.on('tile-changed', (data) => {
        if (currentGame) {
            currentGame.board[data.tileIndex] = data.newValue;
            drawBoard();
        }
    });
    
    socket.on('chat-message', (message) => {
        addChatMessage(message);
    });
    
    socket.on('player-left', (data) => {
        currentGame = data.game;
        updatePlayersInfo(data.game.players);
        if (data.game.players.length < 2) {
            waitingOverlay.classList.remove('hidden');
        }
    });
    
    socket.on('error', (error) => {
        alert(error.message);
    });
    
    socket.on('disconnect', () => {
        console.log('Disconnected from server');
    });
}

// Create board function - now sets up canvas and viewport
function createBoard(size) {
    boardSize = size;
    
    // Initialize cursor at center of board
    cursorX = Math.floor(boardSize / 2);
    cursorY = Math.floor(boardSize / 2);
    
    // Initialize camera to center on cursor
    updateCamera();
    
    // Set high resolution canvas
    setupHighResCanvas();
    
    // Calculate tile size based on canvas dimensions and viewport
    const canvasSize = Math.min(boardCanvas.width, boardCanvas.height);
    tileSize = Math.floor(canvasSize / viewportSize);
    
    // Set up canvas click handler
    boardCanvas.addEventListener('click', handleCanvasClick);
    
    // Set up keyboard controls for cursor movement
    document.addEventListener('keydown', handleKeyDown);
    
    drawBoard();
}

// Setup high resolution canvas
function setupHighResCanvas() {
    const rect = boardCanvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    
    // Set actual size in memory (scaled to account for extra pixel density)
    boardCanvas.width = rect.width * dpr;
    boardCanvas.height = rect.height * dpr;
    
    // Scale the drawing context so everything draws at the correct size
    c.scale(dpr, dpr);
    
    // Set display size (css pixels)
    boardCanvas.style.width = rect.width + 'px';
    boardCanvas.style.height = rect.height + 'px';
}

// Update camera to follow cursor with smooth scrolling
function updateCamera() {
    targetCameraX = cursorX - Math.floor(viewportSize / 2);
    targetCameraY = cursorY - Math.floor(viewportSize / 2);
    
    // Clamp target camera to board boundaries
    targetCameraX = Math.max(0, Math.min(boardSize - viewportSize, targetCameraX));
    targetCameraY = Math.max(0, Math.min(boardSize - viewportSize, targetCameraY));
    
    // Start smooth scrolling animation if not already running
    if (!isScrolling) {
        isScrolling = true;
        animateCamera();
    }
}

// Animate camera movement with smooth interpolation
function animateCamera() {
    const dx = targetCameraX - cameraX;
    const dy = targetCameraY - cameraY;
    
    // Check if we're close enough to the target to stop animating
    if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) {
        cameraX = targetCameraX;
        cameraY = targetCameraY;
        isScrolling = false;
        drawBoard();
        return;
    }
    
    // Interpolate towards target position
    cameraX += dx * scrollSpeed;
    cameraY += dy * scrollSpeed;
    
    drawBoard();
    
    // Continue animation
    animationFrameId = requestAnimationFrame(animateCamera);
}

// Convert 2D board coordinates to 1D array index
function coordsToIndex(row, col) {
    return row * boardSize + col;
}

// Convert 1D array index to 2D board coordinates
function indexToCoords(index) {
    return {
        row: Math.floor(index / boardSize),
        col: index % boardSize
    };
}

// Draw the visible portion of the board with smooth camera positioning
function drawBoard() {
    if (!isInGame || !currentGame) return;
    
    // Get actual canvas dimensions (accounting for device pixel ratio)
    const rect = boardCanvas.getBoundingClientRect();
    const canvasSize = Math.min(rect.width, rect.height);
    tileSize = canvasSize / viewportSize;
    
    c.clearRect(0, 0, rect.width, rect.height);
    
    // Calculate pixel offset for smooth scrolling
    const pixelOffsetX = (cameraX - Math.floor(cameraX)) * tileSize;
    const pixelOffsetY = (cameraY - Math.floor(cameraY)) * tileSize;
    
    // Draw tiles in viewport (plus one extra row/column for smooth scrolling)
    const startX = Math.floor(cameraX);
    const startY = Math.floor(cameraY);
    const endX = startX + viewportSize + 1;
    const endY = startY + viewportSize + 1;
    
    for (let boardY = startY; boardY < endY; boardY++) {
        for (let boardX = startX; boardX < endX; boardX++) {
            // Skip if out of board bounds
            if (boardX >= boardSize || boardY >= boardSize || boardX < 0 || boardY < 0) {
                continue;
            }
            
            const tileIndex = coordsToIndex(boardY, boardX);
            const tileValue = currentGame.board[tileIndex];
            const color = TILE_COLORS[tileValue];
            
            // Determine tile color (checkerboard pattern)
            const isLight = (boardX + boardY) % 2 === 0;
            c.fillStyle = isLight ? color.light : color.dark;
            
            // Calculate pixel position with smooth offset
            const pixelX = (boardX - startX) * tileSize - pixelOffsetX;
            const pixelY = (boardY - startY) * tileSize - pixelOffsetY;
            
            // Draw tile
            c.fillRect(pixelX, pixelY, tileSize, tileSize);
        }
    }

    // Draw cursor highlight
    const pixelX = (cursorX - startX) * tileSize - pixelOffsetX;
    const pixelY = (cursorY - startY) * tileSize - pixelOffsetY;

    c.strokeStyle = '#e74c3c';
    c.lineWidth = 3;
    c.strokeRect(pixelX, pixelY, tileSize, tileSize);
}

// Handle canvas clicks
function handleCanvasClick(event) {
    const rect = boardCanvas.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
    const clickY = event.clientY - rect.top;
    
    const tileX = Math.floor(clickX / tileSize);
    const tileY = Math.floor(clickY / tileSize);
    
    // Convert viewport coordinates to board coordinates
    const boardX = Math.floor(cameraX) + tileX;
    const boardY = Math.floor(cameraY) + tileY;
    
    // Move cursor to clicked tile
    if (boardX >= 0 && boardX < boardSize && boardY >= 0 && boardY < boardSize) {
        cursorX = boardX;
        cursorY = boardY;
        updateCamera();
        toggleTile(boardY, boardX);
    }
}

// Handle keyboard input for cursor movement
function handleKeyDown(event) {
    if (!isInGame) return;
    
    let moved = false;
    
    switch(event.key) {
        case 'ArrowUp':
        case 'w':
        case 'W':
            if (cursorY > 0) {
                cursorY--;
                moved = true;
            }
            break;
        case 'ArrowDown':
        case 's':
        case 'S':
            if (cursorY < boardSize - 1) {
                cursorY++;
                moved = true;
            }
            break;
        case 'ArrowLeft':
        case 'a':
        case 'A':
            if (cursorX > 0) {
                cursorX--;
                moved = true;
            }
            break;
        case 'ArrowRight':
        case 'd':
        case 'D':
            if (cursorX < boardSize - 1) {
                cursorX++;
                moved = true;
            }
            break;
        case ' ':
        case 'Enter':
            toggleTile(cursorY, cursorX);
            moved = true;
            break;
    }
    
    if (moved) {
        event.preventDefault();
        updateCamera();
    }
}

// Create game function
function createGame() {
    const username = hostUsernameInput.value.trim();
    const size = Math.min(150, Math.max(20, parseInt(boardSizeInput.value) || 50));

    if (!username) {
        alert('Please enter your username');
        return;
    }

    currentUser = username;
    isHost = true;
    
    socket.emit('create-game', {
        username: username,
        boardSize: size
    });
}

// Join game function
function joinGame(gameId) {
    const username = playerUsernameInput.value.trim();

    if (!username) {
        alert('Please enter your username');
        return;
    }

    currentUser = username;
    isHost = false;
    
    socket.emit('join-game', {
        gameId: gameId,
        username: username
    });
}

// Send chat message
function sendChat(event) {
    event.preventDefault();
    const message = chatInput.value.trim();
    
    if (message && socket) {
        socket.emit('send-chat', {
            message: message
        });
        chatInput.value = '';
    }
}

// Resign from game
function resignGame() {
    if (confirm('Are you sure you want to resign and leave the game?')) {
        socket.emit('resign-game');
        returnToLobby();
    }
}

// Return to lobby
function returnToLobby() {
    isInGame = false;
    currentGameId = '';
    currentGame = null;
    isHost = false;
    
    // Stop any ongoing camera animation
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }
    isScrolling = false;
    
    // Start game list refresh when returning to lobby
    startGameListRefresh();
    
    // Remove event listeners
    boardCanvas.removeEventListener('click', handleCanvasClick);
    document.removeEventListener('keydown', handleKeyDown);
    
    lobbyScreen.classList.remove('hidden');
    gameScreen.classList.add('hidden');
    gameScreen.style.display = 'none';
    
    // Clear inputs
    hostUsernameInput.value = '';
    playerUsernameInput.value = '';
    
    // Request updated game list
    requestGamesList();
}

// Show game screen
function showGameScreen(game) {
    isInGame = true;
    boardSize = game.boardSize;
    currentGameId = game.id;
    
    // Stop game list refresh when entering game
    stopGameListRefresh();
    
    lobbyScreen.classList.add('hidden');
    gameScreen.classList.remove('hidden');
    gameScreen.style.display = 'flex';
    
    const opponent = game.players.find(p => p.username !== currentUser);
    gameTitle.textContent = opponent ? `vs ${opponent.username}` : 'Tile Battle';
    updatePlayersInfo(game.players);
    
    createBoard(game.boardSize);
    
    // Show/hide waiting overlay
    if (game.players.length < 2) {
        waitingOverlay.classList.remove('hidden');
    } else {
        waitingOverlay.classList.add('hidden');
    }
    
    // Load chat history
    chatMessages.innerHTML = '';
    if (game.messages) {
        game.messages.forEach(msg => addChatMessage(msg));
    }
}

// Toggle tile
function toggleTile(row, col) {
    if (!currentGame || currentGame.players.length < 2) return;
    
    const tileIndex = coordsToIndex(row, col);
    socket.emit('tile-click', { tileIndex: tileIndex });
}

// Update players info
function updatePlayersInfo(players) {
    if (players.length === 1) {
        playersInfo.textContent = `${players[0].username} (waiting for opponent)`;
    } else if (players.length === 2) {
        playersInfo.textContent = `${players[0].username} vs ${players[1].username}`;
    }
}

// Add chat message
function addChatMessage(message) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `chat-message ${message.type}`;
    
    const time = new Date(message.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    
    if (message.type === 'system') {
        messageDiv.innerHTML = `<span class="time">${time}</span>${message.text}`;
    } else {
        messageDiv.innerHTML = `
            <div class="username">${message.username}</div>
            <span class="time">${time}</span>
            ${message.text}
        `;
    }
    
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Request games list from server
function requestGamesList() {
    if (socket) {
        socket.emit('get-games');
    }
}

// Update games list with data from server
function updateGamesList(gameList) {
    if (gameList.length === 0) {
        gamesList.innerHTML = `
            <div class="no-games">
                <p>🔍 No games available</p>
                <p style="font-size: 12px; margin-top: 5px;">Create a new game or wait for others to host!</p>
            </div>
        `;
    } else {
        gamesList.innerHTML = gameList.map(game => `
            <div class="game-item">
                <div class="game-info">
                    <h4>${game.host}'s Game</h4>
                    <div class="game-meta">Board: ${game.boardSize}x${game.boardSize} • Players: ${game.playerCount}/2</div>
                </div>
                <button class="join-btn" onclick="joinGame('${game.id}')">Join</button>
            </div>
        `).join('');
    }
}

// Initialize the application
function init() {
    lobbyScreen.classList.remove('hidden');
    gameScreen.classList.add('hidden');
    gameScreen.style.display = 'none';
    
    // Initialize socket connection
    initializeSocket();
    
    // Start game list refresh loop
    startGameListRefresh();
}

// Start the application
init();