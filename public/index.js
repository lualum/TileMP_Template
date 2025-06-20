// Game state
let currentUser = '';
let currentGameId = '';
let boardSize = 50;
let board = [];
let isInGame = false;
let games = new Map();

// DOM elements
const lobbyScreen = document.getElementById('lobbyScreen');
const gameScreen = document.getElementById('gameScreen');
const hostUsernameInput = document.getElementById('hostUsername');
const playerUsernameInput = document.getElementById('playerUsername');
const boardSizeInput = document.getElementById('boardSize');
const gamesList = document.getElementById('gamesList');
const boardDiv = document.getElementById('board');
const gameTitle = document.getElementById('gameTitle');
const playersInfo = document.getElementById('playersInfo');
const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const waitingOverlay = document.getElementById('waitingOverlay');

// Simulate multiplayer with local storage for demo
let isHost = false;
let gameUpdateInterval;

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
    currentGameId = 'game_' + Date.now();
    
    const newGame = {
        id: currentGameId,
        host: username,
        players: [{username, id: 'player1'}],
        boardSize: size,
        board: Array(size).fill().map(() => Array(size).fill(0)),
        messages: [],
        createdAt: Date.now()
    };

    games.set(currentGameId, newGame);
    saveGames();
    showGameScreen(newGame);
    startGameUpdateLoop();
}

// Join game function
function joinGame(gameId) {
    const username = playerUsernameInput.value.trim();

    if (!username) {
        alert('Please enter your username');
        return;
    }

    const game = games.get(gameId);
    if (!game) {
        alert('Game not found');
        return;
    }

    if (game.players.length >= 2) {
        alert('Game is full');
        return;
    }

    currentUser = username;
    isHost = false;
    currentGameId = gameId;
    
    game.players.push({username, id: 'player2'});
    games.set(gameId, game);
    saveGames();
    
    showGameScreen(game);
    startGameUpdateLoop();
    
    // Add system message
    addSystemMessage(`${username} joined the game`);
}

// Send chat message
function sendChat(event) {
    event.preventDefault();
    const message = chatInput.value.trim();
    
    if (message && currentGameId) {
        const chatMessage = {
            username: currentUser,
            message,
            timestamp: Date.now(),
            type: 'user'
        };
        
        const game = games.get(currentGameId);
        if (game) {
            game.messages.push(chatMessage);
            games.set(currentGameId, game);
            saveGames();
            addChatMessage(chatMessage);
        }
        
        chatInput.value = '';
    }
}

// Resign from game
function resignGame() {
    if (confirm('Are you sure you want to resign and leave the game?')) {
        const game = games.get(currentGameId);
        if (game) {
            // Remove player from game
            game.players = game.players.filter(p => p.username !== currentUser);
            if (game.players.length === 0) {
                games.delete(currentGameId);
            } else {
                games.set(currentGameId, game);
                addSystemMessage(`${currentUser} left the game`);
            }
            saveGames();
        }
        returnToLobby();
    }
}

// Return to lobby
function returnToLobby() {
    isInGame = false;
    currentGameId = '';
    isHost = false;
    
    if (gameUpdateInterval) {
        clearInterval(gameUpdateInterval);
        gameUpdateInterval = null;
    }
    
    lobbyScreen.classList.remove('hidden');
    gameScreen.classList.add('hidden');
    gameScreen.style.display = 'none';
    
    // Clear inputs
    hostUsernameInput.value = '';
    playerUsernameInput.value = '';
    
    // Refresh game list
    loadGames();
    updateGamesList();
}

// Show game screen
function showGameScreen(game) {
    isInGame = true;
    boardSize = game.boardSize;
    
    lobbyScreen.classList.add('hidden');
    gameScreen.classList.remove('hidden');
    gameScreen.style.display = 'flex';
    
    const opponent = game.players.find(p => p.username !== currentUser);
    gameTitle.textContent = opponent ? `vs ${opponent.username}` : 'Tile Battle';
    updatePlayersInfo(game.players);
    
    createBoard(game.boardSize);
    updateBoard(game.board);
    
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

// Create board display
function createBoard(size) {
    boardDiv.innerHTML = '';
    boardDiv.style.gridTemplateColumns = `repeat(${size}, 1fr)`;
    // Calculate tile size based on available space
    const maxBoardSize = Math.min(window.innerWidth - 320, window.innerHeight - 100);
    const tileSize = Math.max(8, Math.floor(maxBoardSize / size));
    
    for (let i = 0; i < size; i++) {
        for (let j = 0; j < size; j++) {
            const tile = document.createElement('button');
            tile.className = 'tile type-0';
            
            // Add checkerboard pattern
            if ((i + j) % 2 === 1) {
                tile.classList.add('dark');
            }
            
            tile.style.width = tileSize + 'px';
            tile.style.height = tileSize + 'px';
            tile.dataset.row = i;
            tile.dataset.col = j;
            tile.onclick = () => toggleTile(i, j);
            boardDiv.appendChild(tile);
        }
    }
}

// Toggle tile
function toggleTile(row, col) {
    const game = games.get(currentGameId);
    if (!game || game.players.length < 2) return;
    
    game.board[row][col] = game.board[row][col] === 0 ? 1 : 0;
    games.set(currentGameId, game);
    saveGames();
    
    updateBoard(game.board);
}

// Update board display
function updateBoard(boardData) {
    const tiles = boardDiv.querySelectorAll('.tile');
    for (let i = 0; i < boardData.length; i++) {
        for (let j = 0; j < boardData[i].length; j++) {
            const tileIndex = i * boardData[i].length + j;
            const tile = tiles[tileIndex];
            if (tile) {
                tile.className = `tile type-${boardData[i][j]}`;
                
                // Preserve checkerboard pattern
                if ((i + j) % 2 === 1) {
                    tile.classList.add('dark');
                }
            }
        }
    }
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
        messageDiv.innerHTML = `<span class="time">${time}</span>${message.message}`;
    } else {
        messageDiv.innerHTML = `
            <div class="username">${message.username}</div>
            <span class="time">${time}</span>
            ${message.message}
        `;
    }
    
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Add system message
function addSystemMessage(message) {
    const systemMessage = {
        message,
        timestamp: Date.now(),
        type: 'system'
    };
    
    const game = games.get(currentGameId);
    if (game) {
        game.messages.push(systemMessage);
        games.set(currentGameId, game);
        saveGames();
    }
    
    addChatMessage(systemMessage);
}

// Load games from localStorage
function loadGames() {
    try {
        const savedGames = localStorage.getItem('tileBattleGames');
        if (savedGames) {
            const gamesArray = JSON.parse(savedGames);
            games.clear();
            gamesArray.forEach(game => {
                // Remove games older than 1 hour
                if (Date.now() - game.createdAt < 3600000) {
                    games.set(game.id, game);
                }
            });
        }
    } catch (e) {
        console.error('Error loading games:', e);
        games.clear();
    }
}

// Save games to localStorage
function saveGames() {
    try {
        const gamesArray = Array.from(games.values());
        localStorage.setItem('tileBattleGames', JSON.stringify(gamesArray));
    } catch (e) {
        console.error('Error saving games:', e);
    }
}

// Update games list
function updateGamesList() {
    loadGames();
    const availableGames = Array.from(games.values()).filter(game => game.players.length < 2);
    
    if (availableGames.length === 0) {
        gamesList.innerHTML = `
            <div class="no-games">
                <p>🔍 No games available</p>
                <p style="font-size: 12px; margin-top: 5px;">Create a new game or wait for others to host!</p>
            </div>
        `;
    } else {
        gamesList.innerHTML = availableGames.map(game => `
            <div class="game-item">
                <div class="game-info">
                    <h4>${game.host}'s Game</h4>
                    <div class="game-meta">Board: ${game.boardSize}x${game.boardSize} • Players: ${game.players.length}/2</div>
                </div>
                <button class="join-btn" onclick="joinGame('${game.id}')">Join</button>
            </div>
        `).join('');
    }
}

// Start game update loop
function startGameUpdateLoop() {
    if (gameUpdateInterval) {
        clearInterval(gameUpdateInterval);
    }
    
    gameUpdateInterval = setInterval(() => {
        if (currentGameId && isInGame) {
            loadGames();
            const game = games.get(currentGameId);
            if (game) {
                // Update UI if needed
                updatePlayersInfo(game.players);
                updateBoard(game.board);
                if (game.players.length < 2) {
                    waitingOverlay.classList.remove('hidden');
                } else {
                    waitingOverlay.classList.add('hidden');
                }
                // Update chat messages
                chatMessages.innerHTML = '';
                game.messages.forEach(msg => addChatMessage(msg));
            }
        }
    }, 1000);
}
// Initial load
loadGames();
updateGamesList();
lobbyScreen.classList.remove('hidden');
gameScreen.classList.add('hidden');
gameScreen.style.display = 'none';  