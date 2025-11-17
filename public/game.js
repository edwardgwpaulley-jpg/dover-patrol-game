const socket = io();

// Game state
let gameState = null;
let roomCode = null;
let selectedPiece = null;
let placementPieces = [];
let placedPieces = [];
let selectedCell = null;
let isDragging = false;
let dragStart = null;
let previousPhase = null;
// Track pieces lost this turn
let lostPiecesThisTurn = []; // Array of {piece: string, player: number}

// Canvas setup
const canvas = document.getElementById('game-board');
const ctx = canvas.getContext('2d');

const BOARD_WIDTH = 8;
const BOARD_HEIGHT = 12;
const CELL_WIDTH = 120; // Wider cells
const CELL_HEIGHT = 80; // Shorter cells to fit on screen
const CANVAS_WIDTH = BOARD_WIDTH * CELL_WIDTH;
const CANVAS_HEIGHT = BOARD_HEIGHT * CELL_HEIGHT;

canvas.width = CANVAS_WIDTH;
canvas.height = CANVAS_HEIGHT;

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

// Initialize piece counts for placement
function initializePieces() {
  placementPieces = [];
  for (const [piece, count] of Object.entries(PIECE_FREQUENCIES)) {
    for (let i = 0; i < count; i++) {
      placementPieces.push({ piece, placed: false });
    }
  }
  renderPieceSelector();
}

function renderPieceSelector() {
  const piecesList = document.getElementById('pieces-list');
  piecesList.innerHTML = '';
  
  const pieceCounts = {};
  placementPieces.forEach(p => {
    if (!p.placed) {
      pieceCounts[p.piece] = (pieceCounts[p.piece] || 0) + 1;
    }
  });

  for (const [piece, count] of Object.entries(pieceCounts)) {
    const item = document.createElement('div');
    item.className = 'piece-item';
    item.textContent = piece;
    item.dataset.piece = piece;
    item.innerHTML = `<span>${piece}</span><span class="piece-count">${count}</span>`;
    item.addEventListener('click', () => selectPieceForPlacement(piece));
    piecesList.appendChild(item);
  }
}

function selectPieceForPlacement(piece) {
  selectedPiece = piece;
  document.querySelectorAll('.piece-item').forEach(item => {
    item.classList.remove('selected');
    if (item.dataset.piece === piece) {
      item.classList.add('selected');
    }
  });
}

// Room management
document.getElementById('create-room-btn').addEventListener('click', () => {
  roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
  socket.emit('create-room', roomCode);
});

document.getElementById('join-room-btn').addEventListener('click', () => {
  const inputCode = document.getElementById('room-code-input').value;
  roomCode = inputCode.toUpperCase();
  if (roomCode) {
    socket.emit('join-room', roomCode);
  }
});

socket.on('room-created', (code) => {
  roomCode = code;
  // Show the room code display
  document.getElementById('room-code-text').textContent = code;
  document.getElementById('room-code-display').classList.remove('hidden');
  document.getElementById('create-room-btn').style.display = 'none';
  document.getElementById('join-room-section').style.display = 'none';
  document.getElementById('room-status').textContent = 'Waiting for opponent to join...';
  // Update corner room code displays
  updateRoomCodeCorner(code);
});

socket.on('room-joined', (code) => {
  roomCode = code;
  document.getElementById('create-room-section').style.display = 'none';
  document.getElementById('join-room-section').style.display = 'none';
  document.getElementById('room-status').textContent = `Successfully joined room: ${code}`;
  document.getElementById('room-status').style.color = '#4CAF50';
  // Update corner room code displays
  updateRoomCodeCorner(code);
});

socket.on('room-error', (error) => {
  document.getElementById('room-status').textContent = `Error: ${error}`;
  document.getElementById('room-status').style.color = '#f44336';
});

socket.on('game-state', (state) => {
  const wasInPlacement = gameState && gameState.phase === 'placement';
  const isNowPlaying = state.phase === 'playing';
  const wasPlaying = gameState && gameState.phase === 'playing';
  const previousPlayer = gameState ? gameState.currentPlayer : null;
  
  // Debug: Log received game state
  console.log('Received game-state:', {
    playerIndex: state.playerIndex,
    currentPlayer: state.currentPlayer,
    phase: state.phase,
    boardPieces: state.board ? state.board.flat().filter(c => c !== null).map(c => ({
      player: c.player,
      piece: c.piece,
      revealed: c.revealed
    })) : 'no board'
  });
  
  // Check if turn changed
  const turnChanged = wasPlaying && isNowPlaying && previousPlayer !== null && previousPlayer !== state.currentPlayer;
  
  // Preserve winning pieces visual state across game-state updates
  // But clear them if turn just changed (any turn, not just yours)
  const preservedWinningPieces = turnChanged ? new Map() : new Map(winningPieces);
  const preservedDefeatedPieces = turnChanged ? new Map() : new Map(defeatedPieces);
  
  gameState = state;
  
  // Clear all overlays when any turn ends (for both players)
  if (turnChanged) {
    // Turn ended - hide ALL opponent pieces that are revealed (they become red dots)
    // Server should handle this, but ensure client state is correct too
    if (gameState && gameState.board) {
      for (let y = 0; y < 12; y++) {
        for (let x = 0; x < 8; x++) {
          const cell = gameState.board[y] && gameState.board[y][x];
          // Hide opponent pieces that are revealed (they become red dots)
          if (cell && cell.player !== gameState.playerIndex && cell.revealed) {
            cell.revealed = false;
          }
        }
      }
    }
    
    // Clear all red overlays (winning pieces)
    winningPieces.forEach((state, key) => {
      const [x, y] = key.split(',').map(Number);
      if (gameState && gameState.board[y] && gameState.board[y][x]) {
        const cell = gameState.board[y][x];
        // Hide the piece again (it becomes a red dot) if it's opponent's piece
        if (cell && cell.player !== gameState.playerIndex) {
          cell.revealed = false;
        }
      }
    });
    winningPieces.clear();
    
    // Clear all green overlays and temporary defeated pieces
    defeatedPieces.forEach((state, key) => {
      if (state.timer) {
        clearTimeout(state.timer);
      }
    });
    defeatedPieces.clear();
    temporaryDefeatedPieces.clear();
    
    // Clear lost pieces list at end of turn
    lostPiecesThisTurn = [];
    updateLostPiecesList();
  } else {
    // Restore visual states (in case game-state update cleared them)
    winningPieces.clear();
    preservedWinningPieces.forEach((value, key) => {
      winningPieces.set(key, value);
    });
    
    defeatedPieces.clear();
    preservedDefeatedPieces.forEach((value, key) => {
      defeatedPieces.set(key, value);
    });
  }
  
  updateUI();
  renderBoard();
  
  // If turn changed, clear all reveal timers (pieces will be hidden by server)
  if (turnChanged) {
    // Turn ended - clear all timers
    revealTimers.forEach((timer) => clearTimeout(timer));
    revealTimers.clear();
  }
  
  // If transitioning from placement to playing, show who starts
  if (wasInPlacement && isNowPlaying) {
    const startingPlayerName = gameState.currentPlayer === 0 ? 'Player 1' : 'Player 2';
    const isMyTurn = gameState.currentPlayer === gameState.playerIndex;
    if (isMyTurn) {
      addMessage('You will start the game!', 'success');
    } else {
      addMessage(`${startingPlayerName} will start the game!`, 'info');
    }
  }
  
  // Update turn indicator and end turn button if in playing phase
  if (gameState && gameState.phase === 'playing') {
    const isMyTurn = gameState.currentPlayer === gameState.playerIndex;
    const turnText = isMyTurn ? 'Your Turn' : `Player ${gameState.currentPlayer + 1}'s Turn`;
    
    // Update turn indicator text
    const turnIndicator = document.getElementById('turn-indicator-text-placement');
    if (turnIndicator) {
      turnIndicator.textContent = turnText;
    }
    
    // Update end turn button visibility
    const endTurnBtn = document.getElementById('end-turn-btn');
    if (endTurnBtn) {
      if (isMyTurn) {
        endTurnBtn.classList.remove('hidden');
        endTurnBtn.style.display = 'block';
      } else {
        endTurnBtn.classList.add('hidden');
        endTurnBtn.style.display = 'none';
      }
    }
  }
  
  previousPhase = gameState ? gameState.phase : null;
});

socket.on('piece-moved', (data) => {
  addMessage(`Piece moved from (${data.fromX}, ${data.fromY}) to (${data.toX}, ${data.toY})`);
});

socket.on('piece-placed', (data) => {
  renderBoard();
});

socket.on('piece-placed-live', (data) => {
  // Opponent placed a piece - show as red dot
  if (!gameState) {
    console.log('Live piece placed but no gameState:', data);
    return;
  }
  
  const { x, y, playerIndex } = data;
  console.log('Live piece placed:', { 
    x, 
    y, 
    playerIndex, 
    myPlayerIndex: gameState.playerIndex,
    isOpponent: playerIndex !== gameState.playerIndex,
    willShow: playerIndex !== gameState.playerIndex,
    boardBefore: gameState.board[y] ? gameState.board[y][x] : 'null'
  });
  
  // Only show opponent's pieces as red dots
  if (playerIndex !== gameState.playerIndex) {
    if (!gameState.board[y]) {
      gameState.board[y] = new Array(BOARD_WIDTH).fill(null);
    }
    gameState.board[y][x] = { 
      player: playerIndex, 
      piece: 'hidden', 
      revealed: false 
    };
    console.log('Updated board with opponent piece:', { x, y, cell: gameState.board[y][x], willRender: true });
    renderBoard();
  } else {
    console.log('Ignoring own piece live update (playerIndex matches)');
  }
});

socket.on('piece-removed-live', (data) => {
  // Opponent removed a piece - remove the red dot
  if (!gameState) {
    return;
  }
  
  const { x, y, playerIndex } = data;
  
  // Only remove opponent's pieces
  if (playerIndex !== gameState.playerIndex) {
    if (gameState.board[y] && gameState.board[y][x] && gameState.board[y][x].player === playerIndex) {
      gameState.board[y][x] = null;
      renderBoard();
    }
  }
});

// Track timers for temporarily revealed pieces
const revealTimers = new Map();
// Track visual states for combat feedback
const defeatedPieces = new Map(); // {x,y} -> {color: 'green', timer: timeout}
const winningPieces = new Map(); // {x,y} -> {color: 'red'}
// Store defeated pieces temporarily so they can be shown with green overlay before disappearing
const temporaryDefeatedPieces = new Map(); // {x,y} -> {cell data, timer}

socket.on('combat-result', (data) => {
  const { attacker, defender, result } = data;
  const isMyAttack = attacker.player === gameState.playerIndex;
  const isMyDefense = defender.player === gameState.playerIndex;
  
  addMessage(`Combat: ${attacker.piece} vs ${defender.piece} - ${result.message}`, 'success');
  
  // Reveal the defender piece temporarily (it's already revealed in gameState from server)
  // Set a timer to hide it after 30 seconds
  const defenderKey = `${defender.x},${defender.y}`;
  
  // Clear any existing timer for this piece
  if (revealTimers.has(defenderKey)) {
    clearTimeout(revealTimers.get(defenderKey));
  }
  
  // Set timer to hide the piece after 30 seconds
  const timer = setTimeout(() => {
    if (gameState && gameState.board[defender.y] && gameState.board[defender.y][defender.x]) {
      const cell = gameState.board[defender.y][defender.x];
      // Only hide if it's an opponent's piece and was temporarily revealed
      if (cell && cell.player !== gameState.playerIndex) {
        cell.revealed = false;
        renderBoard();
      }
    }
    revealTimers.delete(defenderKey);
  }, 30000); // 30 seconds
  
  revealTimers.set(defenderKey, timer);
  
  // Visual feedback for combat results
  if (result.winner === 'attacker') {
    // Attacker wins - defeated piece (defender) turns green for 4 seconds
    // Winning piece (attacker) turns red until end of turn
    const defeatedKey = `${defender.x},${defender.y}`;
    const winningKey = `${attacker.x},${attacker.y}`;
    
    // Track lost piece
    lostPiecesThisTurn.push({ piece: defender.piece, player: defender.player });
    updateLostPiecesList();
    
    // Store the defeated piece temporarily so it can be shown with green overlay
    if (gameState && gameState.board[defender.y] && gameState.board[defender.y][defender.x]) {
      const defeatedCell = gameState.board[defender.y][defender.x];
      // Make a copy of the cell data and mark it as revealed so it shows
      temporaryDefeatedPieces.set(defeatedKey, {
        ...defeatedCell,
        revealed: true
      });
    }
    
    // Mark defeated piece as green for 4 seconds
    if (defeatedPieces.has(defeatedKey)) {
      clearTimeout(defeatedPieces.get(defeatedKey).timer);
    }
    defeatedPieces.set(defeatedKey, { color: 'green' });
    const greenTimer = setTimeout(() => {
      defeatedPieces.delete(defeatedKey);
      temporaryDefeatedPieces.delete(defeatedKey);
      renderBoard();
    }, 4000);
    defeatedPieces.set(defeatedKey, { color: 'green', timer: greenTimer });
    
    // Mark winning piece (attacker) as red until end of turn
    // Make sure the attacker piece is revealed so we can show it with red overlay
    if (gameState && gameState.board[attacker.y] && gameState.board[attacker.y][attacker.x]) {
      const attackerCell = gameState.board[attacker.y][attacker.x];
      if (attackerCell) {
        attackerCell.revealed = true;
      }
    }
    winningPieces.set(winningKey, { color: 'red' });
    
    // Re-render immediately to show both overlays
    renderBoard();
  } else if (result.winner === 'defender') {
    // Defender wins - winning piece (defender) turns red until end of attacker's turn
    // Defeated piece (attacker) turns green for 4 seconds before disappearing
    // Make sure the pieces are revealed so we can show them with overlays
    if (gameState && gameState.board[defender.y] && gameState.board[defender.y][defender.x]) {
      const cell = gameState.board[defender.y][defender.x];
      // Reveal the winning piece temporarily so we can show it with red overlay
      if (cell && cell.player !== gameState.playerIndex) {
        // Opponent's piece that defeated you - show red
        cell.revealed = true;
      } else if (cell && cell.player === gameState.playerIndex) {
        // Your piece that won - also reveal it so both players see it won
        cell.revealed = true;
      }
    }
    
    // Track lost piece
    lostPiecesThisTurn.push({ piece: attacker.piece, player: attacker.player });
    updateLostPiecesList();
    
    // Store the defeated attacker piece temporarily so it can be shown with green overlay
    const attackerKey = `${attacker.x},${attacker.y}`;
    if (gameState && gameState.board[attacker.y] && gameState.board[attacker.y][attacker.x]) {
      const defeatedAttackerCell = gameState.board[attacker.y][attacker.x];
      // Make a copy of the cell data and mark it as revealed so it shows
      temporaryDefeatedPieces.set(attackerKey, {
        ...defeatedAttackerCell,
        revealed: true
      });
    }
    
    // Mark defeated attacker as green for 4 seconds
    if (defeatedPieces.has(attackerKey)) {
      clearTimeout(defeatedPieces.get(attackerKey).timer);
    }
    defeatedPieces.set(attackerKey, { color: 'green' });
    const greenTimer = setTimeout(() => {
      defeatedPieces.delete(attackerKey);
      temporaryDefeatedPieces.delete(attackerKey);
      renderBoard();
    }, 4000);
    defeatedPieces.set(attackerKey, { color: 'green', timer: greenTimer });
    
    const winningKey = `${defender.x},${defender.y}`;
    // Show red overlay for the winning piece (visible to both players)
    winningPieces.set(winningKey, { color: 'red' });
    // Re-render immediately to show both overlays
    renderBoard();
  } else if (result.winner === 'none') {
    // Nothing happens - both pieces stay (e.g., attacking Flying Boat with non-4)
    // Flying Boat is revealed but neither piece is removed
    // No overlays needed, just reveal the Flying Boat
    // The defender (Flying Boat) is already revealed by the server
    renderBoard();
  } else {
    // Both destroyed - show both as green briefly
    // Track both lost pieces
    lostPiecesThisTurn.push({ piece: attacker.piece, player: attacker.player });
    lostPiecesThisTurn.push({ piece: defender.piece, player: defender.player });
    updateLostPiecesList();
    
    const defeatedKey1 = `${attacker.x},${attacker.y}`;
    const defeatedKey2 = `${defender.x},${defender.y}`;
    const greenTimer1 = setTimeout(() => {
      defeatedPieces.delete(defeatedKey1);
      renderBoard();
    }, 4000);
    const greenTimer2 = setTimeout(() => {
      defeatedPieces.delete(defeatedKey2);
      renderBoard();
    }, 4000);
    defeatedPieces.set(defeatedKey1, { color: 'green', timer: greenTimer1 });
    defeatedPieces.set(defeatedKey2, { color: 'green', timer: greenTimer2 });
  }
  
  // Re-render to show the visual feedback
  renderBoard();
});

socket.on('game-over', (data) => {
  showGameOver(data.winner);
});

socket.on('player-left', () => {
  addMessage('Opponent left the game', 'error');
});

socket.on('move-error', (error) => {
  console.log('Move error received:', error); // Debug
  addMessage(error, 'error');
});

// Starting player selection removed - now randomized automatically
// Game state update will handle the transition to playing phase

function updateRoomCodeCorner(code) {
  if (code) {
    document.getElementById('room-code-corner-text').textContent = code;
    document.getElementById('room-code-corner-text-game').textContent = code;
  }
}

function updateUI() {
  if (!gameState) return;

  // Show/hide screens
  if (gameState.phase === 'placement') {
    document.getElementById('room-setup').classList.add('hidden');
    document.getElementById('placement-screen').classList.remove('hidden');
    document.getElementById('starting-player-screen').classList.add('hidden');
    document.getElementById('game-screen').classList.add('hidden');
    // Show room code in corner
    document.getElementById('room-code-corner').classList.remove('hidden');
    document.getElementById('room-code-corner-game').classList.add('hidden');
    
    // Update placement instructions
    const placementInstructions = document.getElementById('placement-instructions');
    if (gameState.playerIndex === 0) {
      placementInstructions.textContent = 'Place all your pieces in the bottom half of the board (bottom 5 rows)';
    } else {
      placementInstructions.textContent = 'Place all your pieces in the top half of the board (top 5 rows) - your pieces will appear at the bottom from your view';
    }
    
    if (!placementPieces.length) {
      initializePieces();
    }
    
    const bothReady = gameState.playersReady.player1 && gameState.playersReady.player2;
    document.getElementById('confirm-placement-btn').disabled = placedPieces.length === 0 || bothReady;
    
    // Hide end turn button during placement
    const endTurnBtn = document.getElementById('end-turn-btn');
    if (endTurnBtn) {
      endTurnBtn.classList.add('hidden');
      endTurnBtn.style.display = 'none';
    }
  // Removed select-starting-player phase - game goes directly to playing phase
  } else if (gameState.phase === 'playing') {
    // Keep the same screen structure - don't switch screens, just update UI
    document.getElementById('room-setup').classList.add('hidden');
    document.getElementById('placement-screen').classList.remove('hidden'); // Keep placement screen visible
    document.getElementById('starting-player-screen').classList.add('hidden');
    document.getElementById('game-screen').classList.add('hidden');
    
    // Hide placement-specific UI elements
    const pieceSelector = document.getElementById('piece-selector');
    if (pieceSelector) {
      // Hide the piece list and placement buttons, but keep the container for the end turn button
      const piecesList = pieceSelector.querySelector('#pieces-list');
      if (piecesList) piecesList.style.display = 'none';
      const randomSetupBtn = document.getElementById('random-setup-btn');
      if (randomSetupBtn) randomSetupBtn.style.display = 'none';
      const confirmBtn = document.getElementById('confirm-placement-btn');
      if (confirmBtn) confirmBtn.style.display = 'none';
      const selectorTitle = pieceSelector.querySelector('h3');
      if (selectorTitle) selectorTitle.style.display = 'none';
    }
    const placementInfo = document.getElementById('placement-info');
    if (placementInfo) placementInfo.style.display = 'none';
    const placementTitle = document.getElementById('placement-title');
    if (placementTitle) placementTitle.style.display = 'none';
    
    // Show end turn button if it's your turn
    const isMyTurn = gameState.currentPlayer === gameState.playerIndex;
    const endTurnBtn = document.getElementById('end-turn-btn');
    if (endTurnBtn) {
      if (isMyTurn) {
        endTurnBtn.classList.remove('hidden');
        endTurnBtn.style.display = 'block';
      } else {
        endTurnBtn.classList.add('hidden');
        endTurnBtn.style.display = 'none';
      }
    }
    
    // Lost pieces sections are handled by updateLostPiecesList()
    
    // Show turn indicator in corner
    const turnText = isMyTurn ? 'Your Turn' : `Player ${gameState.currentPlayer + 1}'s Turn`;
    const turnIndicatorCorner = document.getElementById('turn-indicator-corner-placement');
    if (turnIndicatorCorner) {
      const turnTextEl = document.getElementById('turn-indicator-text-placement');
      if (turnTextEl) turnTextEl.textContent = turnText;
      turnIndicatorCorner.classList.remove('hidden');
    }
    
    // Keep room code visible
    const roomCodeCorner = document.getElementById('room-code-corner');
    if (roomCodeCorner) {
      roomCodeCorner.classList.remove('hidden');
    }
    
    // Ensure board container and canvas stay visible and same size - don't change anything
    const boardContainer = document.getElementById('board-container');
    if (boardContainer) {
      // Don't modify styles - keep as is
    }
    const gameBoard = document.getElementById('game-board');
    if (gameBoard) {
      // Ensure canvas maintains its size
      gameBoard.width = CANVAS_WIDTH;
      gameBoard.height = CANVAS_HEIGHT;
    }
    
    // Make sure board is rendered
    renderBoard();
  }
}

// Random Setup
document.getElementById('random-setup-btn').addEventListener('click', () => {
  if (!gameState || gameState.phase !== 'placement') {
    return;
  }
  
  const playerIndex = gameState.playerIndex;
  const validRows = playerIndex === 0 ? [0, 1, 2, 3, 4] : [7, 8, 9, 10, 11];
  const baseX = playerIndex === 0 ? 2 : 5;
  const baseY = playerIndex === 0 ? 0 : 11;
  
  // Clear existing placements
  // First, remove all placed pieces from board and notify opponent
  placedPieces.forEach(p => {
    if (gameState.board[p.y] && gameState.board[p.y][p.x]) {
      gameState.board[p.y][p.x] = null;
      socket.emit('remove-piece-live', { roomCode, x: p.x, y: p.y });
    }
  });
  
  placedPieces = [];
  placementPieces.forEach(p => p.placed = false);
  
  // Get all unplaced pieces
  const unplacedPieces = [];
  for (const [piece, count] of Object.entries(PIECE_FREQUENCIES)) {
    for (let i = 0; i < count; i++) {
      unplacedPieces.push(piece);
    }
  }
  
  // Shuffle pieces
  for (let i = unplacedPieces.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [unplacedPieces[i], unplacedPieces[j]] = [unplacedPieces[j], unplacedPieces[i]];
  }
  
  // Generate all valid positions
  const validPositions = [];
  for (let y of validRows) {
    for (let x = 0; x < BOARD_WIDTH; x++) {
      // Skip base position
      if (x === baseX && y === baseY) continue;
      validPositions.push({ x, y });
    }
  }
  
  // Shuffle positions
  for (let i = validPositions.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [validPositions[i], validPositions[j]] = [validPositions[j], validPositions[i]];
  }
  
  // Place pieces randomly
  if (unplacedPieces.length > validPositions.length) {
    addMessage('Not enough valid positions for all pieces', 'error');
    return;
  }
  
  for (let i = 0; i < unplacedPieces.length; i++) {
    const piece = unplacedPieces[i];
    const pos = validPositions[i];
    
    // Mark piece as placed
    const pieceIndex = placementPieces.findIndex(p => p.piece === piece && !p.placed);
    if (pieceIndex !== -1) {
      placementPieces[pieceIndex].placed = true;
    }
    
    // Add to placed pieces
    placedPieces.push({ x: pos.x, y: pos.y, piece });
    
    // Update local board
    if (!gameState.board[pos.y]) gameState.board[pos.y] = [];
    gameState.board[pos.y][pos.x] = { player: playerIndex, piece, revealed: true };
    
    // Emit live placement
    socket.emit('place-piece-live', { roomCode, x: pos.x, y: pos.y });
  }
  
  selectedPiece = null;
  renderBoard();
  renderPieceSelector();
  
  document.getElementById('confirm-placement-btn').disabled = false;
  addMessage('Random setup complete!', 'success');
});

// Placement
document.getElementById('confirm-placement-btn').addEventListener('click', () => {
  if (placedPieces.length > 0) {
    socket.emit('place-pieces', { roomCode, pieces: placedPieces });
    addMessage('Placement confirmed. Waiting for opponent...', 'success');
  }
});

canvas.addEventListener('click', (e) => {
  const rect = canvas.getBoundingClientRect();
  const rawX = e.clientX - rect.left;
  const rawY = e.clientY - rect.top;
  const screenX = Math.floor(rawX / CELL_WIDTH);
  const screenY = Math.floor(rawY / CELL_HEIGHT);
  
  console.log('Raw click:', { rawX, rawY, screenX, screenY, canvasHeight: rect.height, cellHeight: CELL_HEIGHT });
  
  // Convert screen coordinates to board coordinates
  // Player 1: screen bottom (Y=11) = board row 0, screen top (Y=0) = board row 11
  // Player 2: screen bottom (Y=11) = board row 11, screen top (Y=0) = board row 0 (flipped view)
  let x, y;
  if (!gameState) {
    // Can't convert without gameState
    return;
  }
  
  if (gameState.playerIndex === 1) {
    // Player 2: flip both X and Y (180 degree rotation to match flipped view)
    // Screen Y 11 (bottom) = board row 11, screen Y 0 (top) = board row 0
    x = BOARD_WIDTH - 1 - screenX;
    y = screenY; // Direct mapping: screen Y = board row
    console.log('Player 2 click:', { screenX, screenY, boardX: x, boardY: y, rawY, percentFromTop: (rawY / rect.height * 100).toFixed(1) + '%' });
  } else {
    // Player 1: normal flip (screen bottom = board row 0)
    // Screen Y 11 (bottom) = board row 0, screen Y 7 (bottom half) = board row 4
    // So: board row = 11 - screen Y
    x = screenX;
    y = BOARD_HEIGHT - 1 - screenY; // 12 - 1 - screenY = 11 - screenY
    console.log('Player 1 click:', { 
      screenX, 
      screenY, 
      boardX: x, 
      boardY: y, 
      calculated: `11 - ${screenY} = ${y}`,
      rawY,
      percentFromTop: (rawY / rect.height * 100).toFixed(1) + '%',
      isBottomHalf: screenY >= 7,
      expected: screenY >= 7 ? 'bottom half (rows 0-4)' : 'top half (rows 7-11)'
    });
  }
  
  if (x < 0 || x >= BOARD_WIDTH || y < 0 || y >= BOARD_HEIGHT) {
    console.log('Click out of bounds:', { x, y });
    return;
  }

  console.log('Phase check:', { phase: gameState?.phase, hasGameState: !!gameState });
  
  if (gameState && gameState.phase === 'placement') {
    console.log('Calling handlePlacementClick');
    handlePlacementClick(x, y);
  } else if (gameState && gameState.phase === 'playing') {
    console.log('Calling handleGameClick');
    handleGameClick(x, y);
  } else {
    console.log('No handler called - phase:', gameState?.phase);
  }
});

function handlePlacementClick(x, y) {
  const playerIndex = gameState.playerIndex;
  // Both players place in bottom half from their perspective (chess-style)
  // Player 1: board rows 0-4 (appears at bottom of screen, screen Y 11-7)
  // Player 2: board rows 7-11 (appears at bottom of their flipped view, screen Y 11-7)
  // For Player 2, screen Y 11 = board row 11, screen Y 7 = board row 7
  const validRows = playerIndex === 0 ? [0, 1, 2, 3, 4] : [7, 8, 9, 10, 11];
  
  // Get the original screenY from the click event (we need to store it)
  console.log('Placement validation:', { 
    playerIndex, 
    x, 
    y, 
    validRows, 
    isValid: validRows.includes(y),
    note: playerIndex === 0 ? 'Player 1 should place in rows 0-4 (bottom half)' : 'Player 2 should place in rows 7-11 (bottom half)'
  });
  
  if (!validRows.includes(y)) {
    const expectedRows = playerIndex === 0 ? 'bottom 5 rows (rows 0-4)' : 'bottom 5 rows (rows 7-11)';
    addMessage(`Invalid placement location. Place pieces in the ${expectedRows}.`, 'error');
    return;
  }

  // Check if trying to place on base
  if (playerIndex === 0 && x === 2 && y === 0) {
    addMessage('Cannot place pieces on your base', 'error');
    return;
  }
  if (playerIndex === 1 && x === 5 && y === 11) {
    addMessage('Cannot place pieces on your base', 'error');
    return;
  }

  // Check if cell already has a piece - if so, unplace it
  if (gameState.board[y][x] !== null) {
    const cell = gameState.board[y][x];
    // Only unplace if it's your own piece (not confirmed yet, so it's revealed)
    if (cell.player === playerIndex && cell.revealed) {
      // Find the piece in placedPieces array
      const placedIndex = placedPieces.findIndex(p => p.x === x && p.y === y);
      if (placedIndex !== -1) {
        const pieceToUnplace = placedPieces[placedIndex].piece;
        
        // Remove from placedPieces
        placedPieces.splice(placedIndex, 1);
        
        // Mark as unplaced in placementPieces
        const pieceIndex = placementPieces.findIndex(p => p.piece === pieceToUnplace && p.placed);
        if (pieceIndex !== -1) {
          placementPieces[pieceIndex].placed = false;
        }
        
        // Remove from board
        gameState.board[y][x] = null;
        
        // Emit removal to server so opponent sees it disappear
        socket.emit('remove-piece-live', { roomCode, x, y });
        
        selectedPiece = null;
        renderBoard();
        renderPieceSelector();
        
        const remaining = placementPieces.filter(p => !p.placed).length;
        document.getElementById('confirm-placement-btn').disabled = placedPieces.length === 0;
        return;
      }
    }
    addMessage('Cell already occupied', 'error');
    return;
  }

  // Check if a piece is selected
  if (!selectedPiece) {
    addMessage('Please select a piece to place', 'error');
    return;
  }

  // Find unplaced piece
  const pieceIndex = placementPieces.findIndex(p => p.piece === selectedPiece && !p.placed);
  if (pieceIndex === -1) {
    addMessage('No more of this piece available', 'error');
    return;
  }

  // Place piece
  placementPieces[pieceIndex].placed = true;
  placedPieces.push({ x, y, piece: selectedPiece });
  
  // Update local board
  if (!gameState.board[y]) gameState.board[y] = [];
  gameState.board[y][x] = { player: playerIndex, piece: selectedPiece, revealed: true };
  
  // Emit piece placement to server so opponent sees it live
  socket.emit('place-piece-live', { roomCode, x, y });
  
  selectedPiece = null;
  renderBoard();
  renderPieceSelector();
  
  const remaining = placementPieces.filter(p => !p.placed).length;
  if (remaining === 0) {
    document.getElementById('confirm-placement-btn').disabled = false;
  }
}

function handleGameClick(x, y) {
  console.log('handleGameClick called:', { x, y, currentPlayer: gameState?.currentPlayer, playerIndex: gameState?.playerIndex, phase: gameState?.phase });
  
  if (!gameState) {
    console.log('No gameState');
    return;
  }
  
  if (gameState.currentPlayer !== gameState.playerIndex) {
    console.log('Not your turn:', { currentPlayer: gameState.currentPlayer, playerIndex: gameState.playerIndex });
    addMessage('Not your turn', 'error');
    return;
  }

  const cell = gameState.board[y] && gameState.board[y][x];
  console.log('Cell retrieved:', { x, y, cell, boardRow: gameState.board[y] ? 'exists' : 'missing' });
  
  if (!selectedCell) {
    // Select piece
    console.log('Attempting to select piece:', { x, y, cell, playerIndex: gameState.playerIndex, currentPlayer: gameState.currentPlayer, phase: gameState.phase });
    
    if (cell && cell.player === gameState.playerIndex) {
      // Check if it's your turn
      if (gameState.currentPlayer !== gameState.playerIndex) {
        addMessage('Not your turn', 'error');
        return;
      }
      selectedCell = { x, y };
      const pieceName = cell.piece === 'hidden' ? 'piece' : cell.piece;
      addMessage(`Selected ${pieceName} at (${x}, ${y})`);
      console.log('Piece selected successfully');
    } else if (cell && cell.player !== gameState.playerIndex) {
      // Clicked opponent piece
      addMessage('That is your opponent\'s piece. Select one of your own pieces.', 'error');
      console.log('Clicked opponent piece:', { 
        cellPlayer: cell.player, 
        myPlayerIndex: gameState.playerIndex,
        match: cell.player === gameState.playerIndex,
        cellPlayerType: typeof cell.player,
        myPlayerIndexType: typeof gameState.playerIndex,
        cell: JSON.stringify(cell), 
        x, 
        y,
        boardRow: gameState.board[y] ? 'exists' : 'missing',
        fullBoardRow: JSON.stringify(gameState.board[y])
      });
    } else if (!cell) {
      addMessage('No piece at this location', 'error');
      console.log('No cell at location');
    } else {
      addMessage('Select one of your pieces', 'error');
      console.log('Unexpected cell state:', cell);
    }
  } else {
    // Move or attack
    if (selectedCell.x === x && selectedCell.y === y) {
      // Deselect
      selectedCell = null;
      addMessage('Selection cleared');
      renderBoard();
      return;
    }

    const fromCell = gameState.board[selectedCell.y][selectedCell.x];
    const toCell = cell;

    // Check if trying to attack with a piece that can't attack
    if (toCell && toCell.player !== gameState.playerIndex) {
      // Attack
      if (fromCell && (fromCell.piece === 'Flying Boat' || fromCell.piece === 'Minelayer')) {
        addMessage(`${fromCell.piece} cannot attack. Select a different piece.`, 'error');
        selectedCell = null;
        renderBoard();
        return;
      }
      socket.emit('attack', { roomCode, fromX: selectedCell.x, fromY: selectedCell.y, toX: x, toY: y });
    } else if (!toCell) {
      // Move
      socket.emit('move-piece', { roomCode, fromX: selectedCell.x, fromY: selectedCell.y, toX: x, toY: y });
    } else {
      addMessage('Invalid move - cannot move onto your own piece', 'error');
      selectedCell = null;
    }
    
    selectedCell = null;
  }
  
  renderBoard();
}

document.getElementById('end-turn-btn').addEventListener('click', () => {
  if (gameState && gameState.currentPlayer === gameState.playerIndex) {
    socket.emit('end-turn', roomCode);
    addMessage('Turn ended', 'success');
  }
});

function renderBoard() {
  ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  
  if (!gameState || !gameState.board) return;

  const playerIndex = gameState.playerIndex;
  const isPlayer2 = playerIndex === 1;

  // Draw grid
  // Player 1: row 0 at bottom, row 11 at top (normal flip)
  // Player 2: row 11 at bottom, row 0 at top (flipped view - chess style)
  for (let boardY = 0; boardY < BOARD_HEIGHT; boardY++) {
    for (let x = 0; x < BOARD_WIDTH; x++) {
      let screenX, screenY;
      
      if (isPlayer2) {
        // Player 2: flip both X and Y (180 degree rotation)
        // Board row 11 appears at screen Y 11 (bottom), row 0 at screen Y 0 (top)
        // So boardY maps directly to screenY: boardY 0 -> screenY 0, boardY 11 -> screenY 11
        screenX = (BOARD_WIDTH - 1 - x) * CELL_WIDTH;
        screenY = boardY * CELL_HEIGHT;
      } else {
        // Player 1: normal flip (row 11 at top, row 0 at bottom)
        // So boardY 0 -> screenY 11, boardY 11 -> screenY 0
        // This means: screenY = (BOARD_HEIGHT - 1 - boardY) = 11 - boardY
        screenX = x * CELL_WIDTH;
        screenY = (BOARD_HEIGHT - 1 - boardY) * CELL_HEIGHT;
      }
      
      const cellX = screenX;
      const cellY = screenY;
      
      // Cell background - sea blue colors
      ctx.fillStyle = (x + boardY) % 2 === 0 ? '#4A90E2' : '#5BA3F5';
      ctx.fillRect(cellX, cellY, CELL_WIDTH, CELL_HEIGHT);
      
      // Base markers (Player 1 at bottom, Player 2 at top)
      if (x === 2 && boardY === 0) {
        // Player 1 base - appears at bottom (screen Y = 11)
        ctx.fillStyle = 'rgba(255, 215, 0, 0.5)';
        ctx.fillRect(cellX, cellY, CELL_WIDTH, CELL_HEIGHT);
        ctx.fillStyle = '#000';
        ctx.font = 'bold 28px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('BASE', cellX + CELL_WIDTH/2, cellY + CELL_HEIGHT/2 + 10);
      }
      if (x === 5 && boardY === 11) {
        // Player 2 base - at top of board (appears at screen Y = 0, top of screen)
        ctx.fillStyle = 'rgba(255, 215, 0, 0.5)';
        ctx.fillRect(cellX, cellY, CELL_WIDTH, CELL_HEIGHT);
        ctx.fillStyle = '#000';
        ctx.font = 'bold 28px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('BASE', cellX + CELL_WIDTH/2, cellY + CELL_HEIGHT/2 + 8);
      }

      // Harbor walls (using board coordinates and screen positions)
      // Pass isPlayer2 flag so walls can be drawn correctly for flipped view
      drawHarborWalls(ctx, x, boardY, cellX, cellY, isPlayer2);
      
      // Pieces (using board coordinates)
      // Check if there's a temporary defeated piece at this location first
      const pieceKey = `${x},${boardY}`;
      let cell = temporaryDefeatedPieces.get(pieceKey);
      
      // If no temporary piece, use the actual board cell
      if (!cell) {
        cell = gameState.board[boardY][x];
      }
      
      if (cell) {
        // Debug: log opponent pieces to see if they're being rendered
        if (cell.player !== playerIndex) {
          console.log(`Rendering opponent piece at (${x},${boardY}): player=${cell.player}, piece=${cell.piece}, revealed=${cell.revealed}, myPlayerIndex=${playerIndex}`);
        }
        drawPiece(ctx, cellX, cellY, cell, x, boardY);
      }
      
      // Selection highlight (using board coordinates)
      if (selectedCell && selectedCell.x === x && selectedCell.y === boardY) {
        ctx.strokeStyle = '#FFFF00';
        ctx.lineWidth = 3;
        ctx.strokeRect(cellX + 2, cellY + 2, CELL_WIDTH - 4, CELL_HEIGHT - 4);
      }
    }
  }
}

function drawHarborWalls(ctx, boardX, boardY, cellX, cellY, isPlayer2) {
  // Player 1's harbor wall (rows 0-2, column 2-3)
  // Blocks movement between columns 2 and 3, and blocks top of square (2,2)
  // For Player 1: appears at bottom (screen Y 11-9)
  // For Player 2: appears at top (screen Y 0-2) due to flipped view
  if (boardY >= 0 && boardY <= 2) {
    if (boardX === 2) {
      // Right side of column 2 (blocks movement to column 3)
      // For Player 2, X is flipped: board column 2 → screen X = (8-1-2)*120 = 600
      // Right side of column 2 = left side of the gap = right edge of cell at screen X 600
      // When flipped, this becomes the left edge of the cell
      const wallX = isPlayer2 ? cellX : (cellX + CELL_WIDTH);
      ctx.strokeStyle = '#654321';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(wallX, cellY);
      ctx.lineTo(wallX, cellY + CELL_HEIGHT);
      ctx.stroke();
    }
    if (boardX === 3 && boardY <= 2) {
      // Left side of column 3 (blocks movement from column 3)
      // For Player 2, X is flipped: board column 3 → screen X = (8-1-3)*120 = 480
      // Left side of column 3 = right side of the gap = left edge of cell at screen X 480
      // When flipped, this becomes the right edge of the cell
      const wallX = isPlayer2 ? (cellX + CELL_WIDTH) : cellX;
      ctx.strokeStyle = '#654321';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(wallX, cellY);
      ctx.lineTo(wallX, cellY + CELL_HEIGHT);
      ctx.stroke();
    }
    if (boardX === 2 && boardY === 2) {
      // Top of square (2,2) for Player 1 (blocks upward movement)
      // For Player 1: board row 2 → screen Y = (12-1-2)*80 = 720 (near bottom)
      // Top edge = cellY (top of cell)
      // For Player 2: board row 2 → screen Y = 2*80 = 160 (near top)
      // Top edge = cellY + CELL_HEIGHT (bottom of cell, which is top from their perspective)
      const wallY = isPlayer2 ? (cellY + CELL_HEIGHT) : cellY;
      ctx.strokeStyle = '#654321';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(cellX, wallY);
      ctx.lineTo(cellX + CELL_WIDTH, wallY);
      ctx.stroke();
    }
  }

  // Player 2's harbor wall (rows 9-11, column 4-5)
  // Blocks movement between columns 4 and 5, and blocks bottom of square (9,5)
  // For Player 1: appears at top (screen Y 2-0)
  // For Player 2: appears at bottom (screen Y 9-11) due to flipped view
  if (boardY >= 9 && boardY <= 11) {
    if (boardX === 5) {
      // Left side of column 5 (blocks movement from column 5 to column 4)
      // For Player 2, X is flipped: board column 5 → screen X = (8-1-5)*120 = 240
      // Left side of column 5 = right side of the gap = left edge of cell at screen X 240
      // When flipped, this becomes the right edge of the cell
      const wallX = isPlayer2 ? (cellX + CELL_WIDTH) : cellX;
      ctx.strokeStyle = '#654321';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(wallX, cellY);
      ctx.lineTo(wallX, cellY + CELL_HEIGHT);
      ctx.stroke();
    }
    if (boardX === 4 && boardY >= 9) {
      // Right side of column 4 (blocks movement from column 4 to column 5)
      // For Player 2, X is flipped: board column 4 → screen X = (8-1-4)*120 = 360
      // Right side of column 4 = left side of the gap = right edge of cell at screen X 360
      // When flipped, this becomes the left edge of the cell
      const wallX = isPlayer2 ? cellX : (cellX + CELL_WIDTH);
      ctx.strokeStyle = '#654321';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(wallX, cellY);
      ctx.lineTo(wallX, cellY + CELL_HEIGHT);
      ctx.stroke();
    }
    // Draw the top wall at row 9 - the top edge of row 9 (two cells in front of Player 2's base at row 11)
    // The wall blocks movement from row 10 to row 9
    // For both players: render at row 9 and use cellY (top edge of row 9)
    if (boardX === 5 && boardY === 9) {
      let wallX, wallY;
      if (isPlayer2) {
        // Player 2: row 9 cellY = 9*80 = 720 (top edge of row 9)
        wallX = (BOARD_WIDTH - 1 - 5) * CELL_WIDTH; // = 240
        wallY = cellY; // Top edge of row 9 = 720
      } else {
        // Player 1: row 9 cellY = (12-1-9)*80 = 160 (top edge of row 9)
        // Bottom edge of row 9 = cellY + CELL_HEIGHT = 160 + 80 = 240
        wallX = 5 * CELL_WIDTH; // = 600
        wallY = cellY + CELL_HEIGHT; // Bottom edge of row 9 = 240
      }
      ctx.strokeStyle = '#654321';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(wallX, wallY);
      ctx.lineTo(wallX + CELL_WIDTH, wallY);
      ctx.stroke();
    }
  }
}

function drawPiece(ctx, x, y, cell, gridX, gridY) {
  const centerX = x + CELL_WIDTH / 2;
  const centerY = y + CELL_HEIGHT / 2;
  
  // Check for visual combat feedback
  const pieceKey = `${gridX},${gridY}`;
  const defeatedState = defeatedPieces.get(pieceKey);
  const winningState = winningPieces.get(pieceKey);
  
  // Only show shape if piece is revealed or it's your own piece
  const isRevealed = cell.revealed || cell.player === gameState.playerIndex;
  
  if (!isRevealed && cell.piece === 'hidden') {
    // Draw hidden piece as red dot (for opponent's pieces during placement)
    // But if it's a winning piece (red), show it as revealed
    if (winningState && winningState.color === 'red') {
      // Show the piece but with red overlay
      const isOwnPiece = cell.player === gameState.playerIndex;
      let pieceColor, strokeColor;
      if (cell.player === 0) {
        pieceColor = isOwnPiece ? '#FF4444' : '#AA0000';
        strokeColor = isOwnPiece ? '#CC0000' : '#880000';
      } else {
        pieceColor = isOwnPiece ? '#4444FF' : '#0000AA';
        strokeColor = isOwnPiece ? '#2222CC' : '#000088';
      }
      // Draw piece with red overlay
      const piece = cell.piece;
      if (piece === 'Mine') {
        drawBomb(ctx, centerX, centerY, pieceColor, strokeColor);
      } else if (piece === 'Flying Boat') {
        drawPlane(ctx, centerX, centerY, pieceColor, strokeColor);
      } else if (piece === 'Submarine') {
        drawSubmarine(ctx, centerX, centerY, pieceColor, strokeColor);
      } else {
        drawBoat(ctx, centerX, centerY, pieceColor, strokeColor, piece);
      }
      // Add red overlay
      ctx.fillStyle = 'rgba(255, 0, 0, 0.4)';
      ctx.fillRect(x, y, CELL_WIDTH, CELL_HEIGHT);
      return;
    } else {
      // Normal hidden piece as red dot
      ctx.fillStyle = '#FF0000';
      ctx.beginPath();
      ctx.arc(centerX, centerY, Math.min(CELL_WIDTH, CELL_HEIGHT) / 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#AA0000';
      ctx.lineWidth = 2;
      ctx.stroke();
      return;
    }
  }
  
  // Piece color
  const isOwnPiece = cell.player === gameState.playerIndex;
  let pieceColor, strokeColor;
  if (cell.player === 0) {
    pieceColor = isOwnPiece ? '#FF4444' : '#AA0000';
    strokeColor = isOwnPiece ? '#CC0000' : '#880000';
  } else {
    pieceColor = isOwnPiece ? '#4444FF' : '#0000AA';
    strokeColor = isOwnPiece ? '#2222CC' : '#000088';
  }
  
  // Apply visual feedback colors
  // Don't change piece colors - use overlays instead for better visibility
  if (winningState && winningState.color === 'red') {
    // Winning piece - red overlay (but keep original colors, add overlay after drawing)
  }
  
  // Draw different shapes based on piece type
  const piece = cell.piece;
  
  if (piece === 'Mine') {
    drawBomb(ctx, centerX, centerY, pieceColor, strokeColor);
  } else if (piece === 'Flying Boat') {
    drawPlane(ctx, centerX, centerY, pieceColor, strokeColor);
  } else if (piece === 'Submarine') {
    drawSubmarine(ctx, centerX, centerY, pieceColor, strokeColor);
  } else {
    // All other pieces (boats, minesweeper, minelayer, numbered pieces)
    drawBoat(ctx, centerX, centerY, pieceColor, strokeColor, piece);
  }
  
  // Add green overlay for defeated pieces (after drawing the piece)
  // Use a lighter overlay with border to make text more visible
  if (defeatedState && defeatedState.color === 'green') {
    // Draw border first for better visibility
    ctx.strokeStyle = '#00FF00';
    ctx.lineWidth = 4;
    ctx.strokeRect(x + 2, y + 2, CELL_WIDTH - 4, CELL_HEIGHT - 4);
    // Lighter overlay so text is more visible
    ctx.fillStyle = 'rgba(0, 255, 0, 0.3)';
    ctx.fillRect(x, y, CELL_WIDTH, CELL_HEIGHT);
  }
  
  // Add red overlay for winning pieces (after drawing the piece, so it's on top)
  // This applies to both revealed and hidden pieces
  if (winningState && winningState.color === 'red') {
    ctx.fillStyle = 'rgba(255, 0, 0, 0.6)';
    ctx.fillRect(x, y, CELL_WIDTH, CELL_HEIGHT);
  }
}

// Cache for emoji images
const emojiCache = {};

function loadEmojiImage(emoji, callback) {
  if (emojiCache[emoji]) {
    callback(emojiCache[emoji]);
    return;
  }
  
  // Use Twemoji CDN for consistent emoji rendering
  const emojiCode = emoji.codePointAt(0).toString(16);
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    emojiCache[emoji] = img;
    callback(img);
  };
  img.onerror = () => {
    // Fallback: try direct emoji rendering
    callback(null);
  };
  img.src = `https://cdn.jsdelivr.net/npm/twemoji@latest/2/svg/${emojiCode}.svg`;
}

function drawBoat(ctx, x, y, fillColor, strokeColor, pieceLabel) {
  const emojiSize = Math.min(CELL_WIDTH, CELL_HEIGHT) * 0.6;
  
  // Use sailboat emoji ⛵
  const boatEmoji = '⛵';
  
  // Draw emoji boat directly (modern browsers support emoji rendering)
  ctx.font = `${emojiSize}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(boatEmoji, x, y);
  
  // Draw piece label/rank below boat
  if (pieceLabel && pieceLabel !== 'hidden') {
    ctx.fillStyle = '#000';
    ctx.font = 'bold 18px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    // Show full names for special pieces, truncate numeric ranks
    let label;
    if (pieceLabel === 'Minelayer' || pieceLabel === 'Minesweeper') {
      label = pieceLabel;
    } else if (pieceLabel.length > 3 && /^\d+$/.test(pieceLabel)) {
      // Truncate numeric ranks longer than 3 characters
      label = pieceLabel.substring(0, 3);
    } else {
      label = pieceLabel;
    }
    ctx.fillText(label, x, y + emojiSize * 0.35);
  }
}

function drawSubmarine(ctx, x, y, fillColor, strokeColor) {
  const size = Math.min(CELL_WIDTH, CELL_HEIGHT) * 0.35;
  
  ctx.fillStyle = fillColor;
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 2;
  
  // Draw submarine (ellipse shape)
  ctx.beginPath();
  ctx.ellipse(x, y, size * 0.8, size * 0.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  
  // Draw conning tower
  ctx.beginPath();
  ctx.rect(x - size * 0.15, y - size * 0.6, size * 0.3, size * 0.4);
  ctx.fill();
  ctx.stroke();
  
  // Draw label
  ctx.fillStyle = '#FFF';
  ctx.font = 'bold 18px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('SUB', x, y);
}

function drawPlane(ctx, x, y, fillColor, strokeColor) {
  const size = Math.min(CELL_WIDTH, CELL_HEIGHT) * 0.5;
  
  ctx.fillStyle = fillColor;
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 2;
  
  // Draw fuselage (main body) - rounded rectangle
  ctx.beginPath();
  ctx.ellipse(x, y, size * 0.4, size * 0.12, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  
  // Draw nose (rounded front)
  ctx.beginPath();
  ctx.arc(x + size * 0.4, y, size * 0.12, -Math.PI / 2, Math.PI / 2);
  ctx.fill();
  ctx.stroke();
  
  // Draw propeller circle
  ctx.fillStyle = '#333';
  ctx.beginPath();
  ctx.arc(x + size * 0.5, y, size * 0.08, 0, Math.PI * 2);
  ctx.fill();
  
  // Draw propeller blades (4 blades in motion)
  ctx.strokeStyle = '#666';
  ctx.lineWidth = 2;
  ctx.beginPath();
  // Top blade
  ctx.moveTo(x + size * 0.5, y);
  ctx.lineTo(x + size * 0.5, y - size * 0.25);
  // Right blade
  ctx.moveTo(x + size * 0.5, y);
  ctx.lineTo(x + size * 0.65, y);
  // Bottom blade
  ctx.moveTo(x + size * 0.5, y);
  ctx.lineTo(x + size * 0.5, y + size * 0.25);
  // Left blade
  ctx.moveTo(x + size * 0.5, y);
  ctx.lineTo(x + size * 0.35, y);
  ctx.stroke();
  
  // Draw top wing (biplane style)
  ctx.fillStyle = fillColor;
  ctx.strokeStyle = strokeColor;
  ctx.beginPath();
  ctx.moveTo(x - size * 0.2, y - size * 0.2);
  ctx.lineTo(x + size * 0.2, y - size * 0.2);
  ctx.lineTo(x + size * 0.15, y - size * 0.35);
  ctx.lineTo(x - size * 0.15, y - size * 0.35);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  
  // Draw bottom wing
  ctx.beginPath();
  ctx.moveTo(x - size * 0.25, y + size * 0.15);
  ctx.lineTo(x + size * 0.25, y + size * 0.15);
  ctx.lineTo(x + size * 0.2, y + size * 0.3);
  ctx.lineTo(x - size * 0.2, y + size * 0.3);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  
  // Draw struts connecting wings
  ctx.strokeStyle = '#555';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x - size * 0.15, y - size * 0.2);
  ctx.lineTo(x - size * 0.2, y + size * 0.15);
  ctx.moveTo(x + size * 0.15, y - size * 0.2);
  ctx.lineTo(x + size * 0.2, y + size * 0.15);
  ctx.stroke();
  
  // Draw tail fin (vertical)
  ctx.fillStyle = fillColor;
  ctx.strokeStyle = strokeColor;
  ctx.beginPath();
  ctx.moveTo(x - size * 0.4, y);
  ctx.lineTo(x - size * 0.55, y - size * 0.4);
  ctx.lineTo(x - size * 0.5, y - size * 0.35);
  ctx.lineTo(x - size * 0.35, y - size * 0.05);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  
  // Draw horizontal tail stabilizers
  ctx.beginPath();
  ctx.moveTo(x - size * 0.4, y);
  ctx.lineTo(x - size * 0.6, y - size * 0.05);
  ctx.lineTo(x - size * 0.55, y - size * 0.05);
  ctx.lineTo(x - size * 0.35, y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  
  // Draw cockpit window
  ctx.fillStyle = '#87CEEB';
  ctx.beginPath();
  ctx.arc(x - size * 0.1, y - size * 0.05, size * 0.06, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawBomb(ctx, x, y, fillColor, strokeColor) {
  const size = Math.min(CELL_WIDTH, CELL_HEIGHT) * 0.3;
  
  ctx.fillStyle = fillColor;
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 2;
  
  // Draw bomb body (rounded top, pointy bottom)
  ctx.beginPath();
  ctx.arc(x, y - size * 0.2, size * 0.4, Math.PI, 0, false);
  ctx.lineTo(x + size * 0.3, y + size * 0.4);
  ctx.lineTo(x, y + size * 0.5);
  ctx.lineTo(x - size * 0.3, y + size * 0.4);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  
  // Draw fuse
  ctx.strokeStyle = '#FFD700';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y - size * 0.6);
  ctx.lineTo(x, y - size * 0.8);
  ctx.stroke();
  
  // Draw spark
  ctx.strokeStyle = '#FF6600';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x, y - size * 0.8);
  ctx.lineTo(x - size * 0.1, y - size * 0.95);
  ctx.moveTo(x, y - size * 0.8);
  ctx.lineTo(x + size * 0.1, y - size * 0.95);
  ctx.stroke();
  
  // Draw "Mine" label below bomb
  ctx.fillStyle = '#000';
  ctx.font = 'bold 18px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('Mine', x, y + size * 0.6);
}

function updateLostPiecesList() {
  if (!gameState) return;
  
  // Get all list elements
  const leftListPlacement = document.getElementById('lost-pieces-list-left-placement');
  const rightListPlacement = document.getElementById('lost-pieces-list-right-placement');
  const leftSectionPlacement = document.getElementById('lost-pieces-left-placement');
  const rightSectionPlacement = document.getElementById('lost-pieces-right-placement');
  
  const leftListGame = document.getElementById('lost-pieces-list-left-game');
  const rightListGame = document.getElementById('lost-pieces-list-right-game');
  const leftSectionGame = document.getElementById('lost-pieces-left-game');
  const rightSectionGame = document.getElementById('lost-pieces-right-game');
  
  // Group pieces by player
  const myPieces = lostPiecesThisTurn.filter(p => p.player === gameState.playerIndex);
  const opponentPieces = lostPiecesThisTurn.filter(p => p.player !== gameState.playerIndex);
  
  // Helper function to update a side list
  const updateSideList = (listEl, sectionEl, pieces) => {
    if (!listEl || !sectionEl) return;
    
    // Clear existing list
    listEl.innerHTML = '';
    
    if (pieces.length === 0) {
      sectionEl.style.display = 'none';
      return;
    }
    
    // Show section
    sectionEl.style.display = 'block';
    
    // Add pieces to list
    pieces.forEach(({ piece }) => {
      const item = document.createElement('div');
      item.className = 'lost-piece-item';
      item.textContent = piece;
      listEl.appendChild(item);
    });
  };
  
  // Update placement screen lists (left = opponent, right = yours)
  updateSideList(leftListPlacement, leftSectionPlacement, opponentPieces);
  updateSideList(rightListPlacement, rightSectionPlacement, myPieces);
  
  // Update game screen lists (left = opponent, right = yours)
  updateSideList(leftListGame, leftSectionGame, opponentPieces);
  updateSideList(rightListGame, rightSectionGame, myPieces);
}

function addMessage(text, type = '') {
  // For error messages, show them ONLY above the board in red (not in side panel)
  if (type === 'error') {
    console.log('Adding error message:', text); // Debug
    
    // Determine which error container to use based on current screen
    let errorContainer = null;
    const placementScreen = document.getElementById('placement-screen');
    const gameScreen = document.getElementById('game-screen');
    
    // Check which screen is visible
    if (placementScreen && !placementScreen.classList.contains('hidden')) {
      errorContainer = document.getElementById('error-messages-placement');
    } else if (gameScreen && !gameScreen.classList.contains('hidden')) {
      errorContainer = document.getElementById('error-messages-game');
    } else {
      // Fallback: try both containers
      errorContainer = document.getElementById('error-messages-game') || 
                       document.getElementById('error-messages-placement');
    }
    
    console.log('Error container found:', errorContainer); // Debug
    
    if (errorContainer) {
      // Make sure container is visible
      errorContainer.style.display = 'flex';
      
      // Clear previous error messages
      errorContainer.innerHTML = '';
      const errorMsg = document.createElement('div');
      errorMsg.className = 'error-message';
      errorMsg.textContent = text;
      errorContainer.appendChild(errorMsg);
      
      console.log('Error message added to container'); // Debug
      
      // Auto-hide after 5 seconds
      setTimeout(() => {
        if (errorContainer && errorContainer.contains(errorMsg)) {
          errorMsg.style.opacity = '0';
          errorMsg.style.transition = 'opacity 0.5s';
          setTimeout(() => {
            if (errorContainer && errorContainer.contains(errorMsg)) {
              errorContainer.removeChild(errorMsg);
            }
          }, 500);
        }
      }, 5000);
    } else {
      console.error('Error container not found!'); // Debug
    }
    // Don't add error messages to side panel - they're user-specific
    return;
  }
  
  // For non-error messages, add to the side panel messages
  const messages = document.getElementById('game-messages');
  if (messages) {
    const message = document.createElement('div');
    message.className = `message ${type}`;
    message.textContent = text;
    messages.insertBefore(message, messages.firstChild);
    
    // Keep only last 10 messages
    while (messages.children.length > 10) {
      messages.removeChild(messages.lastChild);
    }
  }
}

function showGameOver(winner) {
  document.getElementById('game-screen').classList.add('hidden');
  document.getElementById('game-over-screen').classList.remove('hidden');
  
  const isWinner = winner === gameState.playerIndex;
  document.getElementById('winner-message').textContent = 
    isWinner ? 'You Win!' : 'You Lose!';
}

document.getElementById('new-game-btn').addEventListener('click', () => {
  location.reload();
});

// Starting player selection removed - now randomized automatically

// Initialize
initializePieces();

