import { createBoard, dropDisc, type Board, type PlayerColor } from "@/lib/connect-four";

/**
 * Builds a board from 6 strings, top row first: "R" red, "G" green, "." empty.
 * Placed directly, without gravity, so a test can set up any position.
 */
export function boardFrom(rows: string[]): Board {
  const board = createBoard();

  rows.forEach((line, row) => {
    [...line].forEach((char, col) => {
      board[row][col] = char === "R" ? "red" : char === "G" ? "green" : null;
    });
  });

  return board;
}

/** Plays columns one after another, red first, and returns the board and the color that moves next. */
export function playColumns(columns: number[]): { board: Board; next: PlayerColor } {
  let board = createBoard();
  let color: PlayerColor = "red";

  for (const column of columns) {
    const drop = dropDisc(board, column, color);

    if (!drop) {
      throw new Error(`Column ${column} is full`);
    }

    board = drop.board;
    color = color === "red" ? "green" : "red";
  }

  return { board, next: color };
}
