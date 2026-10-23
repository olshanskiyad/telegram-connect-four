"use client";

import type { Board, PlayerColor, WinnerLineCell } from "@/lib/connect-four";

type ConnectFourBoardProps = {
  board: Board;
  activeColor: PlayerColor | null;
  disabled?: boolean;
  highlightLine?: WinnerLineCell[] | null;
  onColumnSelect: (column: number) => void;
  statusLabel?: string;
};

function cellKey(row: number, col: number): string {
  return `${row}:${col}`;
}

function colorLabel(color: PlayerColor): string {
  return color === "red" ? "Красные" : "Зелёные";
}

export function ConnectFourBoard({
  board,
  activeColor,
  disabled = false,
  highlightLine = null,
  onColumnSelect,
  statusLabel
}: ConnectFourBoardProps) {
  const highlightSet = new Set(highlightLine?.map((cell) => cellKey(cell.row, cell.col)) ?? []);
  const heading = activeColor ? colorLabel(activeColor) : "Ожидание старта";

  return (
    <section className="board-shell" aria-label="Игровое поле 7 на 6">
      <div className="board-shell__header">
        <div>
          <p className="eyebrow">{activeColor ? "Ход" : "Статус"}</p>
          <h2>{heading}</h2>
        </div>
        <div className="status-pill">{statusLabel ?? "Нажмите на столбец"}</div>
      </div>

      <div className="board-shell__board" role="grid" aria-label="Игровое поле">
        <div className="board-grid">
          {board.map((row, rowIndex) =>
            row.map((cell, columnIndex) => {
              const key = cellKey(rowIndex, columnIndex);
              const isWinning = highlightSet.has(key);

              return (
                <div
                  key={key}
                  className={[
                    "board-cell",
                    cell ? `board-cell--${cell}` : "",
                    isWinning ? "board-cell--winning" : ""
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  role="gridcell"
                  aria-label={
                    cell
                      ? `${cell === "red" ? "Красная" : "Зелёная"} фишка`
                      : "Пустая ячейка"
                  }
                >
                  <span className="board-cell__disc" />
                </div>
              );
            })
          )}
        </div>

        <div className="board-columns">
          {Array.from({ length: board[0].length }, (_, column) => (
            <button
              key={`column-${column}`}
              type="button"
              className="board-column-hit"
              onClick={() => onColumnSelect(column)}
              disabled={disabled}
            >
              <span className="sr-only">{`Сделать ход в колонку ${column + 1}`}</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
