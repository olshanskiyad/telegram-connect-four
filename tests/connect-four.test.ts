import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BOARD_COLUMNS,
  BOARD_ROWS,
  chooseBotMove,
  createBoard,
  dropDisc,
  findWinner,
  getDropRow,
  isBoardFull,
  nextColor,
  type BotDifficulty
} from "@/lib/connect-four";

import { boardFrom, playColumns } from "./board";

// A full game with no winner: the columns played one after another, red first.
const DRAW_GAME = [
  5, 3, 2, 3, 1, 5, 3, 1, 0, 1, 4, 1, 2, 5, 0, 5, 6, 6, 2, 0, 6, 0, 4, 2, 3, 0, 3, 4, 2, 3, 2, 6, 0, 4, 1, 1, 5, 4, 4, 5, 6, 6
];

function cells(line: { row: number; col: number }[]): string[] {
  return line.map((cell) => `${cell.row}:${cell.col}`).sort();
}

describe("board", () => {
  it("starts empty with 6 rows and 7 columns", () => {
    const board = createBoard();

    assert.equal(board.length, BOARD_ROWS);
    assert.ok(board.every((row) => row.length === BOARD_COLUMNS && row.every((cell) => cell === null)));
    assert.deepEqual(findWinner(board), { kind: "none" });
  });

  it("drops a disc to the lowest free row and stacks the next one on top", () => {
    const first = dropDisc(createBoard(), 3, "red");
    assert.ok(first);
    assert.equal(first.row, BOARD_ROWS - 1);
    assert.equal(first.board[BOARD_ROWS - 1][3], "red");

    const second = dropDisc(first.board, 3, "green");
    assert.ok(second);
    assert.equal(second.row, BOARD_ROWS - 2);
    assert.equal(second.board[BOARD_ROWS - 2][3], "green");
  });

  it("does not change the board it was given", () => {
    const board = createBoard();
    dropDisc(board, 0, "red");

    assert.ok(board.every((row) => row.every((cell) => cell === null)));
  });

  it("alternates colors", () => {
    assert.equal(nextColor("red"), "green");
    assert.equal(nextColor("green"), "red");
  });
});

describe("a move in a full column", () => {
  it("is rejected and leaves the board as it was", () => {
    // Column 3 filled from the bottom with alternating colors (no four in a column).
    const { board } = playColumns([3, 3, 3, 3, 3, 3]);

    assert.equal(getDropRow(board, 3), null);
    assert.equal(dropDisc(board, 3, "red"), null);
    assert.equal(dropDisc(board, 3, "green"), null);
    assert.equal(board[0][3], "green");
    assert.equal(isBoardFull(board), false);
  });

  it("does not block the other columns", () => {
    const { board } = playColumns([3, 3, 3, 3, 3, 3]);

    assert.equal(getDropRow(board, 2), BOARD_ROWS - 1);
    assert.ok(dropDisc(board, 4, "red"));
  });

  it("rejects columns outside the board and fractional columns", () => {
    const board = createBoard();

    for (const column of [-1, BOARD_COLUMNS, 99, 1.5, Number.NaN]) {
      assert.equal(getDropRow(board, column), null, `column ${column}`);
      assert.equal(dropDisc(board, column, "red"), null, `column ${column}`);
    }
  });
});

describe("winner detection", () => {
  it("finds four in a row horizontally", () => {
    const board = boardFrom([
      ".......",
      ".......",
      ".......",
      ".......",
      ".......",
      ".RRRR.."
    ]);
    const result = findWinner(board);

    assert.equal(result.kind, "win");
    assert.ok(result.kind === "win");
    assert.equal(result.winner, "red");
    assert.deepEqual(cells(result.line), ["5:1", "5:2", "5:3", "5:4"]);
  });

  it("finds a horizontal line at both edges of the board", () => {
    for (const row of ["GGGG...", "...GGGG"]) {
      const result = findWinner(boardFrom([".......", ".......", ".......", ".......", ".......", row]));
      assert.ok(result.kind === "win" && result.winner === "green", row);
    }
  });

  it("finds four in a column vertically", () => {
    const board = boardFrom([
      ".......",
      ".......",
      "..G....",
      "..G....",
      "..G....",
      "..G...."
    ]);
    const result = findWinner(board);

    assert.ok(result.kind === "win");
    assert.equal(result.winner, "green");
    assert.deepEqual(cells(result.line), ["2:2", "3:2", "4:2", "5:2"]);
  });

  it("finds a diagonal going down to the right", () => {
    const board = boardFrom([
      ".......",
      ".......",
      "R......",
      ".R.....",
      "..R....",
      "...R..."
    ]);
    const result = findWinner(board);

    assert.ok(result.kind === "win");
    assert.equal(result.winner, "red");
    assert.deepEqual(cells(result.line), ["2:0", "3:1", "4:2", "5:3"]);
  });

  it("finds a diagonal going up to the right", () => {
    const board = boardFrom([
      ".......",
      ".......",
      "...G...",
      "..G....",
      ".G.....",
      "G......"
    ]);
    const result = findWinner(board);

    assert.ok(result.kind === "win");
    assert.equal(result.winner, "green");
    assert.deepEqual(cells(result.line), ["2:3", "3:2", "4:1", "5:0"]);
  });

  it("finds diagonals in the far corners", () => {
    const rightDown = boardFrom([
      ".......",
      ".......",
      "...R...",
      "....R..",
      ".....R.",
      "......R"
    ]);
    const rightUp = boardFrom([
      ".......",
      ".......",
      "......G",
      ".....G.",
      "....G..",
      "...G..."
    ]);

    assert.ok(findWinner(rightDown).kind === "win");
    assert.ok(findWinner(rightUp).kind === "win");
  });

  it("does not count three in a row, a gap or mixed colors", () => {
    const board = boardFrom([
      ".......",
      ".......",
      ".......",
      "R.R....",
      "RRG.GGG",
      "RGRRGRG"
    ]);

    assert.deepEqual(findWinner(board), { kind: "none" });
  });

  it("detects a win made by a real sequence of moves", () => {
    // Red builds a diagonal 1-2-3-4 with green discs underneath.
    const { board } = playColumns([1, 2, 2, 3, 4, 3, 3, 4, 4, 0, 4]);
    const result = findWinner(board);

    assert.ok(result.kind === "win");
    assert.equal(result.winner, "red");
  });
});

describe("draw", () => {
  it("is declared only when the last disc fills the board without a winner", () => {
    let board = createBoard();
    let color = nextColor("green");

    DRAW_GAME.forEach((column, index) => {
      const drop = dropDisc(board, column, color);
      assert.ok(drop, `move ${index + 1}`);
      board = drop.board;

      const result = findWinner(board);
      assert.equal(result.kind, index === DRAW_GAME.length - 1 ? "draw" : "none", `move ${index + 1}`);
      color = nextColor(color);
    });

    assert.equal(isBoardFull(board), true);
  });

  it("has every column full at the end", () => {
    const { board } = playColumns(DRAW_GAME);

    for (let column = 0; column < BOARD_COLUMNS; column += 1) {
      assert.equal(getDropRow(board, column), null);
    }
  });
});

describe("bot", () => {
  const levels: BotDifficulty[] = ["easy", "normal", "hard"];

  it("takes a winning move when it has one", () => {
    // Green (the bot) has three in the bottom row and column 3 is open.
    const board = boardFrom([
      ".......",
      ".......",
      ".......",
      ".......",
      "R.R....",
      "GGG.R.."
    ]);

    for (const level of levels) {
      assert.equal(chooseBotMove(board, "green", level), 3, level);
    }
  });

  it("blocks the opponent's winning move", () => {
    const board = boardFrom([
      ".......",
      ".......",
      ".......",
      ".......",
      "G......",
      "RRR.G.."
    ]);

    for (const level of levels) {
      assert.equal(chooseBotMove(board, "green", level), 3, level);
    }
  });

  it("only plays columns that are not full", () => {
    // Two moves before the end of the drawn game every column is full except column 6.
    const { board, next } = playColumns(DRAW_GAME.slice(0, 40));

    for (const level of levels) {
      assert.equal(chooseBotMove(board, next, level), 6, level);
    }
  });

  it("has no move on a full board", () => {
    const { board } = playColumns(DRAW_GAME);

    for (const level of levels) {
      assert.equal(chooseBotMove(board, "red", level), null, level);
    }
  });
});
