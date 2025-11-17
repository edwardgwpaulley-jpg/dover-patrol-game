const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Store game rooms
const rooms = new Map();

// Piece frequencies
const PIECE_FREQUENCIES = {
  'Mine': 3,
  'Flying Boat': 1,
  'Minelayer': 1,
  'Submarine': 3,
  'Minesweeper': 2,
  '1': 5,
  '2': 5,
  '3': 4,
  '4': 3,
  '5': 4,
  '6': 3,
  '7': 2,
  '8': 1,
  '9': 1,
  '10': 1
};

// Base positions
const PLAYER1_BASE = { x: 2, y: 0 };
const PLAYER2_BASE = { x: 5, y: 11 };

io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);

  socket.on('create-room', (roomCode) => {
    // Normalize room code to uppercase for consistency
    roomCode = roomCode.toUpperCase();
    if (!rooms.has(roomCode)) {
      const gameState = createInitialGameState();
      gameState.players = [socket.id]; // Host is always player 0 (Player 1)
      gameState.hostId = socket.id; // Store host ID
      rooms.set(roomCode, gameState);
      socket.join(roomCode);
      socket.emit('room-created', roomCode);
      socket.emit('game-state', getPublicGameState(roomCode, socket.id));
      console.log(`Room ${roomCode} created by ${socket.id} (Player 1)`);
    } else {
      socket.emit('room-error', 'Room already exists');
    }
  });

  socket.on('join-room', (roomCode) => {
    // Normalize room code to uppercase for consistency
    roomCode = roomCode.toUpperCase();
    const room = rooms.get(roomCode);
    console.log(`Attempting to join room: ${roomCode}`);
    console.log(`Available rooms:`, Array.from(rooms.keys()));
    if (room && room.players.length < 2) {
      room.players.push(socket.id); // Joiner is always player 1 (Player 2)
      socket.join(roomCode);
      socket.emit('room-joined', roomCode);
      // Send game state to each player with their own playerIndex
      room.players.forEach((playerSocketId, index) => {
        const playerSocket = Array.from(io.sockets.sockets.values()).find(s => s.id === playerSocketId);
        if (playerSocket) {
          playerSocket.emit('game-state', getPublicGameState(roomCode, playerSocketId));
        }
      });
      console.log(`Player ${socket.id} joined room ${roomCode} (Player 2)`);
    } else if (!room) {
      console.log(`Room ${roomCode} not found. Available rooms:`, Array.from(rooms.keys()));
      socket.emit('room-error', `Room "${roomCode}" does not exist. Available rooms: ${Array.from(rooms.keys()).join(', ') || 'none'}`);
    } else {
      socket.emit('room-error', 'Room is full');
    }
  });

    socket.on('place-piece-live', (data) => {
      const { roomCode: rawRoomCode, x, y } = data;
      const roomCode = rawRoomCode.toUpperCase();
      const room = rooms.get(roomCode);
      
      if (!room) {
        return; // Silently ignore if room not found
      }

      const playerIndex = room.players.indexOf(socket.id);
      if (playerIndex === -1) {
        return; // Player not in room
      }

      if (room.phase !== 'placement') {
        return; // Ignore if not in placement phase
      }

      // Broadcast to opponent only (not the sender)
      const opponentSocketId = room.players.find(id => id !== socket.id);
      const opponentSocket = Array.from(io.sockets.sockets.values()).find(
        s => s.id === opponentSocketId
      );
      
      console.log(`Live placement: Player ${playerIndex} placed at (${x}, ${y}), broadcasting to opponent ${opponentSocketId ? 'found' : 'not found'}`);
      
      if (opponentSocket) {
        opponentSocket.emit('piece-placed-live', { x, y, playerIndex });
        console.log(`Sent live piece to opponent: x=${x}, y=${y}, playerIndex=${playerIndex}`);
      } else {
        console.log(`Could not find opponent socket. Room players:`, room.players, `Current socket:`, socket.id);
      }
    });

    socket.on('remove-piece-live', (data) => {
      const { roomCode: rawRoomCode, x, y } = data;
      const roomCode = rawRoomCode.toUpperCase();
      const room = rooms.get(roomCode);
      
      if (!room) {
        return; // Silently ignore if room not found
      }

      const playerIndex = room.players.indexOf(socket.id);
      if (playerIndex === -1) {
        return; // Player not in room
      }

      if (room.phase !== 'placement') {
        return; // Ignore if not in placement phase
      }

      // Broadcast removal to opponent only (not the sender)
      const opponentSocketId = room.players.find(id => id !== socket.id);
      const opponentSocket = Array.from(io.sockets.sockets.values()).find(
        s => s.id === opponentSocketId
      );
      
      if (opponentSocket) {
        opponentSocket.emit('piece-removed-live', { x, y, playerIndex });
      }
    });

    socket.on('place-pieces', (data) => {
    const { roomCode: rawRoomCode, pieces } = data;
    const roomCode = rawRoomCode.toUpperCase();
    const room = rooms.get(roomCode);
    
    if (!room) {
      socket.emit('move-error', 'Room not found');
      return;
    }

    const playerIndex = room.players.indexOf(socket.id);
    if (playerIndex === -1) {
      socket.emit('move-error', 'You are not in this room');
      return;
    }

    if (room.phase !== 'placement') {
      socket.emit('move-error', 'Placement phase is over');
      return;
    }

    // Validate placement
    // Player 1 places in bottom half (rows 0-4) - appears at bottom of screen
    // Player 2 places in top half (rows 7-11) - appears at top of screen (but bottom from their perspective)
    const validRows = playerIndex === 0 ? [0, 1, 2, 3, 4] : [7, 8, 9, 10, 11];
    const isValid = pieces.every(p => {
      // Check valid rows
      if (!validRows.includes(p.y)) return false;
      // Check bounds
      if (p.x < 0 || p.x >= 8 || p.y < 0 || p.y >= 12) return false;
      // Check not placing on base
      if (playerIndex === 0 && p.x === 2 && p.y === 0) return false; // Player 1 base at (2, 0)
      if (playerIndex === 1 && p.x === 5 && p.y === 11) return false; // Player 2 base at (5, 11)
      return true;
    });

    if (!isValid) {
      socket.emit('move-error', 'Invalid placement location - cannot place on base');
      return;
    }

    // Store pieces
    if (playerIndex === 0) {
      room.player1Pieces = pieces;
    } else {
      room.player2Pieces = pieces;
    }

    // Update board (show hidden pieces)
    pieces.forEach(p => {
      room.board[p.y][p.x] = { player: playerIndex, piece: p.piece, revealed: false };
    });

    console.log(`Player ${playerIndex} placed ${pieces.length} pieces. Board now has:`);
    let pieceCount = 0;
    for (let y = 0; y < 12; y++) {
      for (let x = 0; x < 8; x++) {
        if (room.board[y][x]) {
          pieceCount++;
          console.log(`  Piece at (${x},${y}): player=${room.board[y][x].player}, piece=${room.board[y][x].piece}`);
        }
      }
    }
    console.log(`Total pieces on board: ${pieceCount}`);

    // Check if both players have placed
    if (room.player1Pieces && room.player2Pieces) {
      // Automatically randomize starting player
      room.currentPlayer = Math.floor(Math.random() * 2);
      room.phase = 'playing';
      console.log(`Both players confirmed! Starting player: ${room.currentPlayer}, phase: ${room.phase}`);
    }

    // Send game state to each player with their own playerIndex
    room.players.forEach((playerSocketId) => {
      const playerSocket = Array.from(io.sockets.sockets.values()).find(s => s.id === playerSocketId);
      if (playerSocket) {
        const gameState = getPublicGameState(roomCode, playerSocketId);
        console.log(`Sending game-state to player ${room.players.indexOf(playerSocketId)}: phase=${gameState.phase}, boardPieces=${gameState.board.flat().filter(c => c !== null).length}`);
        playerSocket.emit('game-state', gameState);
      }
    });
  });

  socket.on('move-piece', (data) => {
    const { roomCode: rawRoomCode, fromX, fromY, toX, toY } = data;
    const roomCode = rawRoomCode.toUpperCase();
    const room = rooms.get(roomCode);
    
    if (!room) {
      console.log(`Move-piece: Room ${roomCode} not found`);
      socket.emit('move-error', 'Room not found');
      return;
    }
    
    if (room.phase !== 'playing') {
      console.log(`Move-piece: Game phase is '${room.phase}', not 'playing'`);
      socket.emit('move-error', `Game not ready - current phase: ${room.phase}`);
      return;
    }

    const playerIndex = room.players.indexOf(socket.id);
    if (playerIndex === -1) {
      socket.emit('move-error', 'You are not in this room');
      return;
    }

    const cell = room.board[fromY] && room.board[fromY][fromX];
    if (!cell || cell.player !== playerIndex) {
      socket.emit('move-error', 'Invalid piece');
      return;
    }

    // Check if piece has already moved this turn
    // Check both the current position (from) and if it was moved to this position this turn
    if (room.movedPieces && room.movedPieces[playerIndex]) {
      // Check if this piece was moved FROM this position (it moved away and came back - shouldn't happen)
      // OR if this piece was moved TO this position (it already moved this turn)
      const hasMoved = room.movedPieces[playerIndex].some(p => 
        (p.x === fromX && p.y === fromY) || 
        (p.fromX === fromX && p.fromY === fromY)
      );
      if (hasMoved) {
        const pieceName = cell.piece || 'piece';
        socket.emit('move-error', `${pieceName} already moved this turn`);
        return;
      }
    }

    // Validate move
    const moveValidation = isValidMove(room, fromX, fromY, toX, toY, cell.piece, playerIndex);
    if (moveValidation !== true) {
      socket.emit('move-error', moveValidation || 'Invalid move');
      return;
    }

    // Check if destination has enemy piece (must use attack instead)
    // The opponent's base is always empty, so pieces can move into it
    const destCell = room.board[toY][toX];
    if (destCell && destCell.player !== playerIndex) {
      socket.emit('move-error', 'Cannot move into enemy square - use attack instead');
      return;
    }

    // Move piece - preserve all properties including player
    room.board[toY][toX] = { 
      player: cell.player, 
      piece: cell.piece, 
      revealed: cell.revealed 
    };
    room.board[fromY][fromX] = null;
    
    console.log(`Piece moved: Player ${cell.player} piece ${cell.piece} from (${fromX},${fromY}) to (${toX},${toY})`);

    // Track moved piece - store both FROM and TO positions
    if (!room.movedPieces) room.movedPieces = { 0: [], 1: [] };
    if (!room.movedPieces[playerIndex]) room.movedPieces[playerIndex] = [];
    room.movedPieces[playerIndex].push({ fromX, fromY, x: toX, y: toY });

    // Check win condition - if piece entered opponent's base, game is over
    const winner = checkWinCondition(room, playerIndex, toX, toY);
    if (winner !== null) {
      io.to(roomCode).emit('game-over', { winner: winner });
      rooms.delete(roomCode);
      return;
    }

    io.to(roomCode).emit('piece-moved', { fromX, fromY, toX, toY, playerIndex });
    // Send game state to each player with their own playerIndex
    room.players.forEach((playerSocketId) => {
      const playerSocket = Array.from(io.sockets.sockets.values()).find(s => s.id === playerSocketId);
      if (playerSocket) {
        playerSocket.emit('game-state', getPublicGameState(roomCode, playerSocketId));
      }
    });
  });

  socket.on('attack', (data) => {
    const { roomCode: rawRoomCode, fromX, fromY, toX, toY } = data;
    const roomCode = rawRoomCode.toUpperCase();
    const room = rooms.get(roomCode);
    
    if (!room || room.phase !== 'playing') {
      socket.emit('move-error', 'Game not ready');
      return;
    }

    const playerIndex = room.players.indexOf(socket.id);
    if (playerIndex === -1) {
      socket.emit('move-error', 'You are not in this room');
      return;
    }

    const attacker = room.board[fromY] && room.board[fromY][fromX];
    const defender = room.board[toY] && room.board[toY][toX];

    console.log(`Attack attempt: Player ${playerIndex} from (${fromX},${fromY}) to (${toX},${toY})`);
    console.log(`Attacker:`, attacker ? { piece: attacker.piece, player: attacker.player } : 'null');
    console.log(`Defender:`, defender ? { piece: defender.piece, player: defender.player } : 'null');
    console.log(`Attacked pieces this turn:`, room.attackedPieces ? room.attackedPieces[playerIndex] : 'none');

    if (!attacker || attacker.player !== playerIndex) {
      socket.emit('move-error', `Invalid attack: No attacker piece at (${fromX}, ${fromY}) or wrong player`);
      return;
    }
    
    if (!defender || defender.player === playerIndex) {
      socket.emit('move-error', `Invalid attack: No defender piece at (${toX}, ${toY}) or defender is your own piece`);
      return;
    }

    // Check if piece has already attacked this turn
    if (room.attackedPieces && room.attackedPieces[playerIndex] && 
        room.attackedPieces[playerIndex].some(p => p.x === fromX && p.y === fromY)) {
      socket.emit('move-error', `This piece at (${fromX}, ${fromY}) has already attacked this turn`);
      return;
    }

    // Validate attack (must be forward, adjacent)
    if (Math.abs(toX - fromX) + Math.abs(toY - fromY) !== 1) {
      socket.emit('move-error', 'Attack must be adjacent');
      return;
    }

    // Check direction (must be forward for attacker)
    const direction = playerIndex === 0 ? 1 : -1;
    if ((toY - fromY) * direction <= 0) {
      socket.emit('move-error', 'Can only attack forward');
      return;
    }

    // Check if piece can attack
    if (attacker.piece === 'Flying Boat' || attacker.piece === 'Minelayer') {
      socket.emit('move-error', `${attacker.piece} cannot attack`);
      return;
    }

    // Reveal both pieces during combat
    attacker.revealed = true;
    defender.revealed = true;
    
    // Track temporarily revealed pieces (both attacker and defender are revealed)
    // We track defender because it's opponent's piece that gets revealed
    // Attacker is current player's piece, so it stays revealed (always visible to owner)
    if (!room.temporarilyRevealed) room.temporarilyRevealed = [];
    // Track defender (opponent piece) - this will be hidden at turn end
    room.temporarilyRevealed.push({ x: toX, y: toY, player: defender.player });
    // Also track attacker if it's an opponent piece (shouldn't happen, but safety)
    if (attacker.player !== playerIndex) {
      room.temporarilyRevealed.push({ x: fromX, y: fromY, player: attacker.player });
    }

    // Resolve combat
    const result = resolveCombat(attacker.piece, defender.piece);
    
    const attackerMoved = room.movedPieces && room.movedPieces[playerIndex] && 
                          room.movedPieces[playerIndex].some(p => p.x === fromX && p.y === fromY);
    
    if (result.winner === 'attacker') {
      // Attacker wins - remove defender, but attacker stays in place (doesn't auto-advance)
      // Player can manually move the attacker forward later if they want
      if (attacker.piece === 'Mine') {
        // Mine suicide - remove both pieces
        room.board[fromY][fromX] = null;
        room.board[toY][toX] = null;
      } else {
        // Attacker stays in its original position, defender is removed
        room.board[toY][toX] = null;
      }
    } else if (result.winner === 'defender') {
      // Defender wins - remove attacker
      room.board[fromY][fromX] = null;
      // If defender is a Mine, it also destroys itself (suicide)
      // But if attacker is a Mine attacking Minesweeper, only the Mine (attacker) is removed
      if (defender.piece === 'Mine') {
        room.board[toY][toX] = null;
      }
      // Otherwise defender stays (e.g., Minesweeper stays when it defeats Mine)
    } else if (result.winner === 'none') {
      // Nothing happens - both pieces stay (e.g., attacking Flying Boat with non-4)
      // Pieces are already revealed, but neither is removed
      // Attacker stays in place, defender (Flying Boat) stays and is revealed
      // No board changes needed - both pieces remain
    } else {
      // Both destroyed (e.g., Mine attacks non-Minesweeper and both are destroyed)
      room.board[fromY][fromX] = null;
      room.board[toY][toX] = null;
    }

    // Track attacked piece ONLY if it still exists on the board after combat
    // (i.e., attacker won and wasn't destroyed, like a Mine suicide)
    if (!room.attackedPieces) room.attackedPieces = { 0: [], 1: [] };
    if (!room.attackedPieces[playerIndex]) room.attackedPieces[playerIndex] = [];
    
    // Only track if the attacker piece still exists (wasn't destroyed)
    if (room.board[fromY] && room.board[fromY][fromX] && room.board[fromY][fromX].player === playerIndex) {
      room.attackedPieces[playerIndex].push({ x: fromX, y: fromY });
    }

    io.to(roomCode).emit('combat-result', {
      attacker: { x: fromX, y: fromY, piece: attacker.piece, player: attacker.player },
      defender: { x: toX, y: toY, piece: defender.piece, player: defender.player },
      result: result
    });

    // Check win condition - if attacker is in opponent's base, they win
    // After attack, attacker stays at fromX, fromY (doesn't advance automatically)
    // So we check if the attacker's current position is the opponent's base
    const winner = checkWinCondition(room, playerIndex, fromX, fromY);
    if (winner !== null) {
      io.to(roomCode).emit('game-over', { winner: winner });
      rooms.delete(roomCode);
      return;
    }

    // Send game state to each player with their own playerIndex (so they see revealed pieces)
    room.players.forEach((playerSocketId) => {
      const playerSocket = Array.from(io.sockets.sockets.values()).find(s => s.id === playerSocketId);
      if (playerSocket) {
        playerSocket.emit('game-state', getPublicGameState(roomCode, playerSocketId));
      }
    });
  });

  // Removed select-starting-player handler - starting player is now randomized automatically

  socket.on('end-turn', (rawRoomCode) => {
    const roomCode = rawRoomCode.toUpperCase();
    const room = rooms.get(roomCode);
    if (room && room.players.indexOf(socket.id) === room.currentPlayer) {
      // Reset moved and attacked pieces for next turn
      // Hide temporarily revealed pieces when turn ends
      // Hide ALL pieces of the player who just ended their turn (so opponent sees them as red dots)
      const currentPlayerIndex = room.currentPlayer; // Player who just ended their turn
      
      // First, hide pieces tracked in temporarilyRevealed
      if (room.temporarilyRevealed) {
        room.temporarilyRevealed.forEach(({ x, y, player }) => {
          const cell = room.board[y] && room.board[y][x];
          // Hide pieces that were temporarily revealed during combat
          if (cell && cell.player === player) {
            cell.revealed = false;
          }
        });
        room.temporarilyRevealed = [];
      }
      
      // CRITICAL: Hide ALL pieces of the player who just ended their turn
      // This makes them appear as red dots to the opponent
      // The player who just ended their turn's pieces should become hidden
      for (let y = 0; y < 12; y++) {
        for (let x = 0; x < 8; x++) {
          const cell = room.board[y] && room.board[y][x];
          // Hide pieces of the player who just ended their turn (they become red dots for opponent)
          if (cell && cell.player === currentPlayerIndex && cell.revealed) {
            console.log(`Hiding piece at (${x},${y}): Player ${cell.player} (just ended turn), piece ${cell.piece}`);
            cell.revealed = false;
          }
        }
      }
      
      room.movedPieces = { 0: [], 1: [] };
      room.attackedPieces = { 0: [], 1: [] };
      room.currentPlayer = (room.currentPlayer + 1) % 2;
      // Send game state to each player with their own playerIndex
      room.players.forEach((playerSocketId) => {
        const playerSocket = Array.from(io.sockets.sockets.values()).find(s => s.id === playerSocketId);
        if (playerSocket) {
          playerSocket.emit('game-state', getPublicGameState(roomCode, playerSocketId));
        }
      });
    }
  });

  socket.on('disconnect', () => {
    console.log('Player disconnected:', socket.id);
    for (const [roomCode, room] of rooms.entries()) {
      const index = room.players.indexOf(socket.id);
      if (index !== -1) {
        room.players.splice(index, 1);
        if (room.players.length === 0) {
          rooms.delete(roomCode);
          console.log(`Room ${roomCode} deleted (empty)`);
        } else {
          io.to(roomCode).emit('player-left');
        }
      }
    }
  });
});

function createInitialGameState() {
  const board = [];
  for (let y = 0; y < 12; y++) {
    board[y] = [];
    for (let x = 0; x < 8; x++) {
      board[y][x] = null;
    }
  }
  return {
    board,
    player1Pieces: null,
    player2Pieces: null,
    phase: 'placement',
    currentPlayer: 0,
    players: [],
    movedPieces: { 0: [], 1: [] },
    attackedPieces: { 0: [], 1: [] },
    temporarilyRevealed: []
  };
}

function getPublicGameState(roomCode, socketId) {
  const room = rooms.get(roomCode);
  if (!room) return null;

  const playerIndex = room.players.indexOf(socketId);
  const publicBoard = room.board.map((row, rowIndex) => 
    row.map((cell, colIndex) => {
      if (!cell) return null;
      // Show own pieces fully, show enemy pieces as hidden unless revealed
      // CRITICAL: Preserve the original player property from the server board
      const cellPlayer = cell.player;
      if (cellPlayer === playerIndex) {
        return { player: cellPlayer, piece: cell.piece, revealed: true };
      } else {
        // Opponent piece - show as hidden unless revealed
        const isRevealed = cell.revealed === true;
        const pieceToShow = isRevealed ? cell.piece : 'hidden';
        console.log(`getPublicGameState: Player ${playerIndex} sees opponent piece at (${colIndex},${rowIndex}): player=${cellPlayer}, piece=${cell.piece}, revealed=${cell.revealed}, showing as=${pieceToShow}`);
        return { player: cellPlayer, piece: pieceToShow, revealed: isRevealed };
      }
    })
  );
  
  // Debug: Log any pieces that might have wrong player values
  for (let y = 0; y < 12; y++) {
    for (let x = 0; x < 8; x++) {
      const cell = room.board[y] && room.board[y][x];
      if (cell && (cell.player !== 0 && cell.player !== 1)) {
        console.log(`WARNING: Piece at (${x},${y}) has invalid player value:`, cell);
      }
    }
  }

  return {
    board: publicBoard,
    phase: room.phase,
    currentPlayer: room.currentPlayer,
    playerIndex: playerIndex,
    playersReady: {
      player1: room.player1Pieces !== null,
      player2: room.player2Pieces !== null
    }
  };
}

function isValidMove(room, fromX, fromY, toX, toY, piece, playerIndex) {
  // Check bounds
  if (toX < 0 || toX >= 8 || toY < 0 || toY >= 12) {
    return 'Move is out of bounds';
  }
  
  // Check destination is empty
  if (room.board[toY][toX] !== null) {
    return 'Destination is not empty';
  }

  // Mines cannot move
  if (piece === 'Mine') {
    return 'Mines cannot move';
  }

  // Check direction (only cardinal directions)
  const dx = Math.abs(toX - fromX);
  const dy = Math.abs(toY - fromY);
  if ((dx === 0 && dy === 0) || (dx > 0 && dy > 0)) {
    return 'Can only move in cardinal directions (up, down, left, right)';
  }

  // Check distance
  const distance = dx + dy;
  
  // Check harbor wall blocking (all pieces except Flying Boat are blocked)
  if (piece !== 'Flying Boat') {
    console.log(`Checking wall blocking: Player ${playerIndex} ${piece} from (${fromX},${fromY}) to (${toX},${toY})`);
    const isBlocked = isHarborWallBlocking(fromX, fromY, toX, toY, playerIndex);
    if (isBlocked) {
      console.log(`Wall blocking move: Player ${playerIndex} ${piece} from (${fromX},${fromY}) to (${toX},${toY})`);
      return 'Cannot move through the harbor wall';
    }
  }

  // Flying Boats can jump over pieces and move up to 2 squares
  if (piece === 'Flying Boat') {
    // Check if jumping wall - need to detect if move crosses wall boundary
    // Player 1's wall: row 2↔3 boundary in column 2, column 2↔3 boundary in rows 0-2
    // Player 2's wall: row 9↔8 boundary in column 5, column 4↔5 boundary in rows 9-11
    let crossesWall = false;
    
    // Check if crossing Player 1's wall vertical boundary (row 2↔3) in column 2
    // The wall is between row 2 and 3, so crossing means: fromY <= 2 and toY >= 3, or fromY >= 3 and toY <= 2
    if (fromX === 2 && toX === 2) {
      if ((fromY <= 2 && toY >= 3) || (fromY >= 3 && toY <= 2)) {
        crossesWall = true;
      }
    }
    
    // Check if crossing Player 1's wall horizontal boundary (column 2↔3) in rows 0-2
    // The wall is between column 2 and 3, so crossing means: fromX <= 2 and toX >= 3, or fromX >= 3 and toX <= 2
    if ((fromY >= 0 && fromY <= 2) && (toY >= 0 && toY <= 2)) {
      if ((fromX <= 2 && toX >= 3) || (fromX >= 3 && toX <= 2)) {
        crossesWall = true;
      }
    }
    
    // Check if crossing Player 2's wall vertical boundary (row 9↔8) in column 5
    // The wall is between row 8 and 9, so crossing means: fromY <= 8 and toY >= 9, or fromY >= 9 and toY <= 8
    if (fromX === 5 && toX === 5) {
      if ((fromY <= 8 && toY >= 9) || (fromY >= 9 && toY <= 8)) {
        crossesWall = true;
      }
    }
    
    // Check if crossing Player 2's wall horizontal boundary (column 4↔5) in rows 9-11
    // The wall is between column 4 and 5, so crossing means: fromX <= 4 and toX >= 5, or fromX >= 5 and toX <= 4
    if ((fromY >= 9 && fromY <= 11) && (toY >= 9 && toY <= 11)) {
      if ((fromX <= 4 && toX >= 5) || (fromX >= 5 && toX <= 4)) {
        crossesWall = true;
      }
    }
    
    if (crossesWall) {
      // When jumping the wall, Flying Boat can only move 1 square total (wall counts as 1 square)
      if (distance !== 1) {
        console.log(`Flying Boat wall jump blocked: distance=${distance}, from (${fromX},${fromY}) to (${toX},${toY})`);
        return 'Flying Boat can only move 1 square when jumping the wall';
      }
      console.log(`Flying Boat wall jump allowed: distance=${distance}, from (${fromX},${fromY}) to (${toX},${toY})`);
      return true;
    }
    
    // Normal move (not jumping wall) - can move up to 2 squares
    if (distance > 2) {
      return 'Flying Boat can only move up to 2 squares';
    }
    return true;
  }

  // Patrol Boat can move up to 2 spaces
  if (piece === '1' || piece === 'Patrol Boat') {
    if (distance > 2) {
      return 'Patrol Boat can only move up to 2 squares';
    }
    return true;
  }

  // All other pieces move 1 square
  if (distance !== 1) {
    return 'This piece can only move 1 square';
  }
  
  return true;
}

function isHarborWallBlocking(fromX, fromY, toX, toY, playerIndex) {
  console.log(`isHarborWallBlocking called: Player ${playerIndex} from (${fromX},${fromY}) to (${toX},${toY})`);
  
  // Check both walls - all pieces (except Flying Boats) are blocked by both walls
  
  // Player 1's harbor wall (rows 0-2, column 2-3)
  // Block horizontal movement crossing the wall boundary between columns 2 and 3
  if ((fromX === 2 && toX === 3) || (fromX === 3 && toX === 2)) {
    if ((fromY >= 0 && fromY <= 2) && (toY >= 0 && toY <= 2)) {
      console.log(`WALL BLOCK: Player ${playerIndex} horizontal move across P1 wall: (${fromX},${fromY}) -> (${toX},${toY})`);
      return true;
    }
  }
  
  // Block vertical movement across the top of Player 1's wall (row 2↔3 boundary)
  // Only block in column 2, and only when crossing the boundary (row 2↔3)
  // Do NOT block movement within the wall area (row 0↔1, row 1↔2)
  if ((fromY === 2 && toY === 3) || (fromY === 3 && toY === 2)) {
    if (fromX === 2 && toX === 2) {
      console.log(`WALL BLOCK: Player ${playerIndex} vertical move across P1 wall top boundary: (${fromX},${fromY}) -> (${toX},${toY})`);
      return true;
    }
  }

  // Player 2's harbor wall (rows 9-11, column 4-5)
  // Block horizontal movement crossing the wall boundary between columns 4 and 5
  if ((fromX === 4 && toX === 5) || (fromX === 5 && toX === 4)) {
    if ((fromY >= 9 && fromY <= 11) && (toY >= 9 && toY <= 11)) {
      console.log(`WALL BLOCK: Player ${playerIndex} horizontal move across P2 wall: (${fromX},${fromY}) -> (${toX},${toY})`);
      return true;
    }
  }
  
  // Block vertical movement across the top of Player 2's wall (row 9↔8 boundary)
  // Only block in column 5, and only when crossing the boundary (row 9↔8)
  // Do NOT block movement within the wall area (row 9↔10, row 10↔11)
  if ((fromY === 9 && toY === 8) || (fromY === 8 && toY === 9)) {
    if (fromX === 5 && toX === 5) {
      console.log(`WALL BLOCK: Player ${playerIndex} vertical move across P2 wall top boundary: (${fromX},${fromY}) -> (${toX},${toY})`);
      return true;
    }
  }

  console.log(`No wall block: Player ${playerIndex} from (${fromX},${fromY}) to (${toX},${toY})`);
  return false;
}

function resolveCombat(attackerPiece, defenderPiece) {
  // Special piece rules
  if (attackerPiece === 'Mine') {
    if (defenderPiece === 'Minesweeper') {
      return { winner: 'defender', message: 'Minesweeper destroys Mine' };
    }
    if (defenderPiece === 'Minelayer') {
      return { winner: 'defender', message: 'Minelayer destroys Mine' };
    }
    // Mine kills everything else, but also destroys itself (suicide)
    return { winner: 'both', message: 'Mine destroys ' + defenderPiece + ' (Mine also destroyed)' };
  }

  if (defenderPiece === 'Mine') {
    if (attackerPiece === 'Minesweeper') {
      return { winner: 'attacker', message: 'Minesweeper destroys Mine' };
    }
    if (attackerPiece === 'Minelayer') {
      return { winner: 'attacker', message: 'Minelayer destroys Mine' };
    }
    // Mine kills everything else, but also destroys itself (suicide)
    return { winner: 'both', message: 'Mine destroys ' + attackerPiece + ' (Mine also destroyed)' };
  }

  if (attackerPiece === 'Flying Boat') {
    // Flying Boat cannot attack - nothing happens, both pieces stay
    return { winner: 'none', message: 'Flying Boat cannot attack - nothing happens' };
  }

  if (defenderPiece === 'Flying Boat') {
    // Flying Boats can ONLY be killed by rank 4 specifically (not higher ranks)
    if (attackerPiece === '4') {
      return { winner: 'attacker', message: '4 destroys Flying Boat' };
    }
    // When attacked by anything else, nothing happens - both pieces stay, Flying Boat is just revealed
    return { winner: 'none', message: 'Flying Boat cannot be killed by ' + attackerPiece + ' - nothing happens' };
  }

  if (attackerPiece === 'Minelayer') {
    return { winner: 'defender', message: 'Minelayer cannot attack' };
  }

  if (defenderPiece === 'Minelayer') {
    // Minelayers can only be killed by Mines and rank 4
    if (attackerPiece === 'Mine' || attackerPiece === '4') {
      return { winner: 'attacker', message: attackerPiece + ' destroys Minelayer' };
    }
    // Minelayers defeat everything else (including rank 2)
    return { winner: 'defender', message: 'Minelayer destroys ' + attackerPiece };
  }

  if (attackerPiece === 'Submarine') {
    if (defenderPiece === '2' || defenderPiece === 'Minelayer') {
      return { winner: 'defender', message: defenderPiece + ' destroys Submarine' };
    }
    if (defenderPiece === 'Mine') {
      return { winner: 'both', message: 'Submarine and Mine both destroyed' };
    }
    return { winner: 'attacker', message: 'Submarine destroys ' + defenderPiece };
  }

  if (defenderPiece === 'Submarine') {
    if (attackerPiece === '2' || attackerPiece === 'Minelayer') {
      return { winner: 'attacker', message: attackerPiece + ' destroys Submarine' };
    }
    if (attackerPiece === 'Mine') {
      return { winner: 'both', message: 'Submarine and Mine both destroyed' };
    }
    return { winner: 'defender', message: 'Submarine destroys ' + attackerPiece };
  }

  if (attackerPiece === 'Minesweeper') {
    if (defenderPiece === 'Mine') {
      return { winner: 'attacker', message: 'Minesweeper destroys Mine' };
    }
    return { winner: 'defender', message: defenderPiece + ' destroys Minesweeper' };
  }

  if (defenderPiece === 'Minesweeper') {
    // Minesweepers can only kill Mines
    if (attackerPiece === 'Mine') {
      return { winner: 'defender', message: 'Minesweeper destroys Mine' };
    }
    // Minesweepers are killed by everything else (including rank 2)
    return { winner: 'attacker', message: attackerPiece + ' destroys Minesweeper' };
  }

  // Normal pieces - compare ranks
  const attackerRank = getRank(attackerPiece);
  const defenderRank = getRank(defenderPiece);

  if (attackerRank === null || defenderRank === null) {
    return { winner: 'defender', message: 'Invalid pieces' };
  }

  // Special rules for rank 2 (Torpedo Boat)
  // Rank 2 can ONLY kill: rank 1, Submarines, and Minesweepers
  if (attackerPiece === '2') {
    if (defenderPiece === 'Submarine' || defenderPiece === 'Minesweeper') {
      return { winner: 'attacker', message: 'Torpedo Boat destroys ' + defenderPiece };
    }
    // Only kill rank 1 (defenderRank === 1)
    if (defenderRank === 1) {
      return { winner: 'attacker', message: 'Torpedo Boat destroys ' + defenderPiece };
    }
    // Rank 2 loses to everything else (rank 3+)
    return { winner: 'defender', message: defenderPiece + ' destroys Torpedo Boat' };
  }

  if (defenderPiece === '2') {
    if (attackerPiece === 'Submarine' || attackerPiece === 'Minesweeper') {
      return { winner: 'defender', message: 'Torpedo Boat destroys ' + attackerPiece };
    }
    // Only kill rank 1 (attackerRank === 1)
    if (attackerRank === 1) {
      return { winner: 'defender', message: 'Torpedo Boat destroys ' + attackerPiece };
    }
    // Rank 2 loses to everything else (rank 3+)
    return { winner: 'attacker', message: attackerPiece + ' destroys Torpedo Boat' };
  }

  // Special rules for rank 4
  if (attackerPiece === '4') {
    if (defenderPiece === 'Minelayer' || defenderPiece === 'Flying Boat') {
      return { winner: 'attacker', message: '4 destroys ' + defenderPiece };
    }
    if (defenderRank < 4) {
      return { winner: 'attacker', message: '4 destroys ' + defenderPiece };
    }
    return { winner: 'defender', message: defenderPiece + ' destroys 4' };
  }

  if (defenderPiece === '4') {
    if (attackerPiece === 'Minelayer' || attackerPiece === 'Flying Boat') {
      return { winner: 'defender', message: '4 destroys ' + attackerPiece };
    }
    if (attackerRank < 4) {
      return { winner: 'defender', message: '4 destroys ' + attackerPiece };
    }
    return { winner: 'attacker', message: attackerPiece + ' destroys 4' };
  }

  // Standard rank comparison
  if (attackerRank > defenderRank) {
    return { winner: 'attacker', message: attackerPiece + ' destroys ' + defenderPiece };
  } else if (defenderRank > attackerRank) {
    return { winner: 'defender', message: defenderPiece + ' destroys ' + attackerPiece };
  } else {
    return { winner: 'both', message: 'Both pieces destroyed' };
  }
}

function getRank(piece) {
  const rankMap = {
    '1': 1, '2': 2, '3': 3, '4': 4, '5': 5,
    '6': 6, '7': 7, '8': 8, '9': 9, '10': 10
  };
  return rankMap[piece] || null;
}

function checkWinCondition(room, playerIndex, x, y) {
  // Player 1 base: row 0, col 2 (bottom of screen)
  // Player 2 base: row 11, col 5 (top of board, appears at top of screen)
  // Win by reaching opponent's base
  if (playerIndex === 0 && y === 11 && x === 5) {
    return 0; // Player 1 wins by reaching Player 2's base
  }
  if (playerIndex === 1 && y === 0 && x === 2) {
    return 1; // Player 2 wins by reaching Player 1's base
  }
  return null;
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
