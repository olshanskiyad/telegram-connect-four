export const BOARD_ROWS = 6;
export const BOARD_COLUMNS = 7;

export type PlayerColor = "red" | "green";
export type Cell = PlayerColor | null;
export type Board = Cell[][];
export type BotDifficulty = "easy" | "normal" | "hard";

export type WinnerLineCell = {
  row: number;
  col: number;
};

export type GameResult =
  | {
      kind: "win";
      winner: PlayerColor;
      line: WinnerLineCell[];
    }
  | {
      kind: "draw";
    }
  | {
      kind: "none";
    };

export function createBoard(): Board {
  return Array.from({ length: BOARD_ROWS }, () => Array<Cell>(BOARD_COLUMNS).fill(null));
}

export function cloneBoard(board: Board): Board {
  return board.map((row) => [...row]);
}

export function nextColor(color: PlayerColor): PlayerColor {
  return color === "red" ? "green" : "red";
}

export function isBoardFull(board: Board): boolean {
  return board[0].every((cell) => cell !== null);
}

export function getDropRow(board: Board, column: number): number | null {
  if (!Number.isInteger(column) || column < 0 || column >= BOARD_COLUMNS) {
    return null;
  }

  for (let row = BOARD_ROWS - 1; row >= 0; row -= 1) {
    if (!board[row][column]) {
      return row;
    }
  }

  return null;
}

export function dropDisc(
  board: Board,
  column: number,
  color: PlayerColor
): { board: Board; row: number; column: number } | null {
  const row = getDropRow(board, column);

  if (row === null) {
    return null;
  }

  const nextBoard = cloneBoard(board);
  nextBoard[row][column] = color;

  return {
    board: nextBoard,
    row,
    column
  };
}

function readCell(board: Board, row: number, col: number): Cell {
  if (row < 0 || row >= BOARD_ROWS || col < 0 || col >= BOARD_COLUMNS) {
    return null;
  }

  return board[row][col];
}

export function findWinner(board: Board): GameResult {
  const directions: Array<[number, number]> = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1]
  ];

  for (let row = 0; row < BOARD_ROWS; row += 1) {
    for (let col = 0; col < BOARD_COLUMNS; col += 1) {
      const cell = board[row][col];

      if (!cell) {
        continue;
      }

      for (const [deltaRow, deltaCol] of directions) {
        const line: WinnerLineCell[] = [{ row, col }];

        for (let step = 1; step < 4; step += 1) {
          const nextCell = readCell(board, row + deltaRow * step, col + deltaCol * step);
          if (nextCell !== cell) {
            line.length = 0;
            break;
          }

          line.push({
            row: row + deltaRow * step,
            col: col + deltaCol * step
          });
        }

        if (line.length === 4) {
          return {
            kind: "win",
            winner: cell,
            line
          };
        }
      }
    }
  }

  if (isBoardFull(board)) {
    return {
      kind: "draw"
    };
  }

  return {
    kind: "none"
  };
}

function columnPriority(column: number): number {
  const preference = [3, 2, 4, 1, 5, 0, 6];
  const index = preference.indexOf(column);
  return index === -1 ? preference.length : index;
}

function orderedColumns(): number[] {
  return [3, 2, 4, 1, 5, 0, 6];
}

function findPlayableColumn(board: Board, columns: number[]): number | null {
  const ordered = [...columns].sort((left, right) => columnPriority(left) - columnPriority(right));

  for (const column of ordered) {
    if (getDropRow(board, column) !== null) {
      return column;
    }
  }

  return null;
}

function findImmediateWin(board: Board, color: PlayerColor): number | null {
  for (let column = 0; column < BOARD_COLUMNS; column += 1) {
    const simulation = dropDisc(board, column, color);
    if (!simulation) {
      continue;
    }

    const result = findWinner(simulation.board);
    if (result.kind === "win" && result.winner === color) {
      return column;
    }
  }

  return null;
}

function listPlayableColumns(board: Board): number[] {
  return orderedColumns().filter((column) => getDropRow(board, column) !== null);
}

function countCenterDiscs(board: Board, color: PlayerColor): number {
  const centerColumn = Math.floor(BOARD_COLUMNS / 2);
  return board.reduce((sum, row) => sum + (row[centerColumn] === color ? 1 : 0), 0);
}

function evaluateWindow(window: Cell[], color: PlayerColor): number {
  const opponent = nextColor(color);
  const ownCount = window.filter((cell) => cell === color).length;
  const opponentCount = window.filter((cell) => cell === opponent).length;
  const emptyCount = window.filter((cell) => cell === null).length;

  if (ownCount === 4) return 100000;
  if (opponentCount === 4) return -100000;

  let score = 0;

  if (ownCount === 3 && emptyCount === 1) score += 120;
  else if (ownCount === 2 && emptyCount === 2) score += 24;
  else if (ownCount === 1 && emptyCount === 3) score += 4;

  if (opponentCount === 3 && emptyCount === 1) score -= 130;
  else if (opponentCount === 2 && emptyCount === 2) score -= 18;

  return score;
}

function evaluateBoard(board: Board, color: PlayerColor): number {
  let score = countCenterDiscs(board, color) * 9;

  for (let row = 0; row < BOARD_ROWS; row += 1) {
    for (let col = 0; col < BOARD_COLUMNS - 3; col += 1) {
      score += evaluateWindow(
        [board[row][col], board[row][col + 1], board[row][col + 2], board[row][col + 3]],
        color
      );
    }
  }

  for (let row = 0; row < BOARD_ROWS - 3; row += 1) {
    for (let col = 0; col < BOARD_COLUMNS; col += 1) {
      score += evaluateWindow(
        [board[row][col], board[row + 1][col], board[row + 2][col], board[row + 3][col]],
        color
      );
    }
  }

  for (let row = 0; row < BOARD_ROWS - 3; row += 1) {
    for (let col = 0; col < BOARD_COLUMNS - 3; col += 1) {
      score += evaluateWindow(
        [
          board[row][col],
          board[row + 1][col + 1],
          board[row + 2][col + 2],
          board[row + 3][col + 3]
        ],
        color
      );
    }
  }

  for (let row = 3; row < BOARD_ROWS; row += 1) {
    for (let col = 0; col < BOARD_COLUMNS - 3; col += 1) {
      score += evaluateWindow(
        [
          board[row][col],
          board[row - 1][col + 1],
          board[row - 2][col + 2],
          board[row - 3][col + 3]
        ],
        color
      );
    }
  }

  return score;
}

function scoreTerminal(result: GameResult, color: PlayerColor, depth: number): number {
  if (result.kind === "draw") {
    return 0;
  }

  if (result.kind === "win") {
    return result.winner === color ? 1000000 + depth : -1000000 - depth;
  }

  return 0;
}

function minimax(
  board: Board,
  depth: number,
  alpha: number,
  beta: number,
  maximizing: boolean,
  botColor: PlayerColor
): number {
  const result = findWinner(board);
  if (depth === 0 || result.kind !== "none") {
    return result.kind === "none" ? evaluateBoard(board, botColor) : scoreTerminal(result, botColor, depth);
  }

  const playable = listPlayableColumns(board);
  if (playable.length === 0) {
    return 0;
  }

  if (maximizing) {
    let value = Number.NEGATIVE_INFINITY;
    for (const column of playable) {
      const next = dropDisc(board, column, botColor);
      if (!next) continue;
      value = Math.max(value, minimax(next.board, depth - 1, alpha, beta, false, botColor));
      alpha = Math.max(alpha, value);
      if (alpha >= beta) break;
    }
    return value;
  }

  const humanColor = nextColor(botColor);
  let value = Number.POSITIVE_INFINITY;
  for (const column of playable) {
    const next = dropDisc(board, column, humanColor);
    if (!next) continue;
    value = Math.min(value, minimax(next.board, depth - 1, alpha, beta, true, botColor));
    beta = Math.min(beta, value);
    if (alpha >= beta) break;
  }
  return value;
}

function chooseStrategicMove(board: Board, botColor: PlayerColor, depth: number): number | null {
  const humanColor = nextColor(botColor);
  const botWin = findImmediateWin(board, botColor);

  if (botWin !== null) {
    return botWin;
  }

  const blockHuman = findImmediateWin(board, humanColor);

  if (blockHuman !== null) {
    return blockHuman;
  }

  const playable = listPlayableColumns(board);
  if (playable.length === 0) {
    return null;
  }

  let bestColumn: number | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const column of playable) {
    const next = dropDisc(board, column, botColor);
    if (!next) {
      continue;
    }

    // Never choose a move that gives the human an immediate winning reply if another safe option exists.
    const opponentReply = findImmediateWin(next.board, humanColor);
    const safetyPenalty = opponentReply !== null ? 5000 : 0;
    const score = minimax(
      next.board,
      depth - 1,
      Number.NEGATIVE_INFINITY,
      Number.POSITIVE_INFINITY,
      false,
      botColor
    ) - safetyPenalty;

    if (score > bestScore) {
      bestScore = score;
      bestColumn = column;
    }
  }

  return bestColumn ?? findPlayableColumn(board, orderedColumns());
}

function chooseEasyMove(board: Board, botColor: PlayerColor): number | null {
  const humanColor = nextColor(botColor);
  const botWin = findImmediateWin(board, botColor);
  if (botWin !== null) {
    return botWin;
  }

  const blockHuman = findImmediateWin(board, humanColor);
  if (blockHuman !== null) {
    return blockHuman;
  }

  const playable = listPlayableColumns(board);
  if (playable.length === 0) {
    return null;
  }

  const weighted = playable.flatMap((column) => {
    const weight = Math.max(1, 4 - columnPriority(column));
    return Array.from({ length: weight }, () => column);
  });

  const randomIndex = Math.floor(Math.random() * weighted.length);
  return weighted[randomIndex] ?? playable[0] ?? null;
}

export function chooseBotMove(
  board: Board,
  botColor: PlayerColor,
  difficulty: BotDifficulty = "normal"
): number | null {
  if (difficulty === "easy") {
    return chooseEasyMove(board, botColor);
  }

  if (difficulty === "hard") {
    return chooseStrategicMove(board, botColor, 5);
  }

  return chooseStrategicMove(board, botColor, 3);
}

export function colorLabel(color: PlayerColor): string {
  return color === "red" ? "красные" : "зелёные";
}
