const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Serve static files
app.use(express.static('public'));

// Store game rooms
const games = new Map();

// Store user information
const users = new Map();

// Clamp board size between 20 and 150
function clampBoardSize(size) {
    return Math.max(20, Math.min(150, parseInt(size) || 50));
}

// Initialize a new board with given size (1D array for easier indexing)
function createBoard(size) {
    const board = [];
    for (let i = 0; i < size * size; i++) {
        board.push(0); // 0 or 1 for two tile types
    }
    return board;
}

// Create a new game
function createGame(roomId, hostName, boardSize) {
    const size = clampBoardSize(boardSize);
    return {
        id: roomId,
        host: hostName,
        players: [],
        board: createBoard(size),
        boardSize: size,
        status: 'waiting', // waiting, playing, finished
        created: Date.now(),
        lastActivity: Date.now(),
        messages: []
    };
}

// Broadcast updated game list to all clients
function broadcastGameList() {
    const gameList = Array.from(games.values())
        .filter(game => game.status === 'waiting' && game.players.length < 2)
        .map(game => ({
            id: game.id,
            host: game.host,
            playerCount: game.players.length,
            boardSize: game.boardSize,
            created: game.created
        }));
    
    io.emit('game-list', gameList);
}

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // Handle creating a new game
    socket.on('create-game', (data) => {
        const { username, boardSize } = data;
        const gameId = `game_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        users.set(socket.id, { username, gameId, isHost: true });
        
        const game = createGame(gameId, username, boardSize);
        game.players.push({ id: socket.id, username, isHost: true });
        games.set(gameId, game);
        
        socket.join(gameId);
        
        socket.emit('game-created', { gameId, game });
        broadcastGameList();
        
        console.log(`${username} created game: ${gameId}`);
    });

    // Handle joining a game
    socket.on('join-game', (data) => {
        const { gameId, username } = data;
        const game = games.get(gameId);
        
        if (!game) {
            socket.emit('error', { message: 'Game not found' });
            return;
        }
        
        if (game.players.length >= 2) {
            socket.emit('error', { message: 'Game is full' });
            return;
        }
        
        if (game.status !== 'waiting') {
            socket.emit('error', { message: 'Game already in progress' });
            return;
        }
        
        users.set(socket.id, { username, gameId, isHost: false });
        game.players.push({ id: socket.id, username, isHost: false });
        
        socket.join(gameId);
        
        // Start the game when 2 players join
        if (game.players.length === 2) {
            game.status = 'playing';
        }
        
        // Send game state to all players
        io.to(gameId).emit('game-joined', { game });
        
        // Add system message
        const joinMessage = {
            type: 'system',
            text: `${username} joined the game`,
            timestamp: Date.now()
        };
        game.messages.push(joinMessage);
        io.to(gameId).emit('chat-message', joinMessage);
        
        broadcastGameList();
        console.log(`${username} joined game: ${gameId}`);
    });

    // Handle getting game list
    socket.on('get-games', () => {
        const gameList = Array.from(games.values())
            .filter(game => game.status === 'waiting' && game.players.length < 2)
            .map(game => ({
                id: game.id,
                host: game.host,
                playerCount: game.players.length,
                boardSize: game.boardSize,
                created: game.created
            }));
        socket.emit('game-list', gameList);
    });

    // Handle tile clicks
    socket.on('tile-click', (data) => {
        const user = users.get(socket.id);
        if (!user) return;

        const game = games.get(user.gameId);
        if (!game || game.status !== 'playing') return;

        const { tileIndex } = data;
        
        // Validate tile index
        if (tileIndex < 0 || tileIndex >= game.board.length) return;

        // Toggle tile (0 becomes 1, 1 becomes 0)
        game.board[tileIndex] = game.board[tileIndex] === 0 ? 1 : 0;
        game.lastActivity = Date.now();

        // Broadcast tile change to all players in game
        io.to(user.gameId).emit('tile-changed', {
            tileIndex,
            newValue: game.board[tileIndex],
            username: user.username
        });
    });

    // Handle chat messages
    socket.on('send-chat', (data) => {
        const user = users.get(socket.id);
        if (!user) return;

        const game = games.get(user.gameId);
        if (!game) return;

        const message = {
            type: 'user',
            username: user.username,
            text: data.message,
            timestamp: Date.now()
        };

        game.messages.push(message);
        
        // Keep only last 50 messages
        if (game.messages.length > 50) {
            game.messages = game.messages.slice(-50);
        }

        io.to(user.gameId).emit('chat-message', message);
    });

    // Handle resign/leave game
    socket.on('resign-game', () => {
        handlePlayerLeave(socket.id, 'resigned');
    });

    // Handle disconnect
    socket.on('disconnect', () => {
        handlePlayerLeave(socket.id, 'disconnected');
        console.log('User disconnected:', socket.id);
    });

    function handlePlayerLeave(socketId, reason) {
        const user = users.get(socketId);
        if (!user) return;

        const game = games.get(user.gameId);
        if (game) {
            // Remove player from game
            game.players = game.players.filter(p => p.id !== socketId);
            
            // Add system message
            const leaveMessage = {
                type: 'system',
                text: `${user.username} ${reason}`,
                timestamp: Date.now()
            };
            game.messages.push(leaveMessage);
            io.to(user.gameId).emit('chat-message', leaveMessage);

            if (game.players.length === 0) {
                // Delete empty game
                games.delete(user.gameId);
            } else {
                // Notify remaining player and reset game to waiting
                game.status = 'waiting';
                io.to(user.gameId).emit('player-left', { 
                    game, 
                    leftPlayer: user.username,
                    reason 
                });
            }
            
            broadcastGameList();
        }
        
        users.delete(socketId);
        console.log(`${user?.username || 'Unknown'} ${reason}`);
    }
});

// Clean up old games periodically
setInterval(() => {
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;
    
    for (const [gameId, game] of games.entries()) {
        if (now - game.lastActivity > oneHour) {
            games.delete(gameId);
            console.log(`Cleaned up inactive game: ${gameId}`);
        }
    }
    
    // Broadcast updated game list after cleanup
    broadcastGameList();
}, 5 * 60 * 1000); // Check every 5 minutes

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Tile Game Server running on port ${PORT}`);
});