"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import {
  chooseBotMove,
  createBoard,
  dropDisc,
  findWinner,
  nextColor,
  type Board,
  type BotDifficulty,
  type PlayerColor,
  type WinnerLineCell
} from "@/lib/connect-four";
import { postJson } from "@/lib/api";
import { useSession } from "@/lib/session";

import { ConnectFourBoard } from "./connect-four-board";

type MatchState = {
  board: Board;
  turn: PlayerColor;
  winnerLine: WinnerLineCell[];
  result: string | null;
  outcome: "win" | "loss" | "draw" | null;
  status: "playing" | "won" | "draw";
};

type QueueState = {
  status: "idle" | "waiting" | "matched";
  queuePosition: number | null;
  waitingCount: number;
  room: {
    inviteCode: string;
  } | null;
};

function createBotMatchId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `bot-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function colorLabel(color: PlayerColor): string {
  return color === "red" ? "Красные" : "Зелёные";
}

function difficultyLabel(difficulty: BotDifficulty): string {
  if (difficulty === "easy") return "Лёгкий";
  if (difficulty === "hard") return "Сложный";
  return "Обычный";
}

function createMatchState(): MatchState {
  return {
    board: createBoard(),
    turn: "red",
    winnerLine: [],
    result: null,
    outcome: null,
    status: "playing"
  };
}

export default function BotGame() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const session = useSession();
  const { initData, profile } = session;
  const [match, setMatch] = useState<MatchState>(() => createMatchState());
  const [round, setRound] = useState(1);
  const [botThinking, setBotThinking] = useState(false);
  const [botMatchId, setBotMatchId] = useState(() => createBotMatchId());
  const botRecordedRef = useRef<string | null>(null);

  const [statusMessage, setStatusMessage] = useState("Играем против бота.");
  const [queueState, setQueueState] = useState<QueueState>({
    status: "idle",
    queuePosition: null,
    waitingCount: 0,
    room: null
  });
  const [queueBusy, setQueueBusy] = useState(false);
  const [sessionScore, setSessionScore] = useState({ player: 0, bot: 0 });

  const humanColor: PlayerColor = "red";
  const botColor: PlayerColor = "green";
  const showOutcome = match.status === "won" || match.status === "draw";
  const queueMode = searchParams.get("queue") === "1";
  const requestedDifficulty = searchParams.get("difficulty");
  const difficulty: BotDifficulty =
    requestedDifficulty === "easy" || requestedDifficulty === "hard" ? requestedDifficulty : "normal";

  useEffect(() => {
    if (!queueMode || !initData) {
      return;
    }

    let cancelled = false;

    async function syncQueue() {
      try {
        const payload = await postJson<{ matchmaking: QueueState }>("/api/matchmaking", {
          action: "status",
          initData
        });

        if (cancelled) {
          return;
        }

        setQueueState(payload.matchmaking);

        if (payload.matchmaking.status === "matched" && payload.matchmaking.room?.inviteCode) {
          router.replace(`/room/${payload.matchmaking.room.inviteCode}?source=random`);
          return;
        }

        if (payload.matchmaking.status === "waiting") {
          setStatusMessage("Вы в очереди. Пока можно играть с ботом.");
          return;
        }

        setStatusMessage("Очередь обновляется.");
      } catch {
        if (!cancelled) {
          setStatusMessage("Не удалось проверить очередь.");
        }
      }
    }

    void syncQueue();
    const timer = window.setInterval(() => {
      void syncQueue();
    }, 2500);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [initData, queueMode, router]);

  async function cancelQueue() {
    if (!queueMode || queueBusy || !initData) {
      return;
    }

    setQueueBusy(true);

    try {
      await postJson<{ matchmaking: QueueState }>("/api/matchmaking", {
        action: "cancel",
        initData
      });

      router.replace("/random");
    } catch {
      setStatusMessage("Не удалось выйти из очереди.");
    } finally {
      setQueueBusy(false);
    }
  }

  useEffect(() => {
    if (!initData || !profile || !match.outcome || match.status === "playing") {
      return;
    }

    if (botRecordedRef.current === botMatchId) {
      return;
    }

    const controller = new AbortController();

    postJson<{ ok: boolean }>(
      "/api/stats/bot",
      {
        initData,
        matchId: botMatchId,
        outcome: match.outcome
      },
      controller.signal
    )
      .then(() => {
        botRecordedRef.current = botMatchId;
      })
      .catch(() => undefined);

    return () => controller.abort();
  }, [botMatchId, initData, match.outcome, match.status, profile]);

  useEffect(() => {
    if (!match.outcome || match.status === "playing") {
      return;
    }

    setSessionScore((current) => {
      if (match.outcome === "win") {
        return { ...current, player: current.player + 1 };
      }

      if (match.outcome === "loss") {
        return { ...current, bot: current.bot + 1 };
      }

      return current;
    });
  }, [botMatchId, match.outcome, match.status]);

  useEffect(() => {
    if (match.status !== "playing" || match.turn !== botColor) {
      return;
    }

    setBotThinking(true);

    const timer = window.setTimeout(() => {
      const chosenColumn = chooseBotMove(match.board, botColor, difficulty);

      if (chosenColumn === null) {
        setBotThinking(false);
        return;
      }

      const move = dropDisc(match.board, chosenColumn, botColor);

      if (!move) {
        setBotThinking(false);
        return;
      }

      const nextBoard = move.board;
      const outcome = findWinner(nextBoard);

      if (outcome.kind === "win") {
        setMatch({
          board: nextBoard,
          turn: botColor,
          winnerLine: outcome.line,
          result: `${colorLabel(outcome.winner)} победили`,
          outcome: outcome.winner === humanColor ? "win" : "loss",
          status: "won"
        });
        setBotThinking(false);
        return;
      }

      if (outcome.kind === "draw") {
        setMatch({
          board: nextBoard,
          turn: botColor,
          winnerLine: [],
          result: "Ничья",
          outcome: "draw",
          status: "draw"
        });
        setBotThinking(false);
        return;
      }

      setMatch({
        board: nextBoard,
        turn: nextColor(botColor),
        winnerLine: [],
        result: null,
        outcome: null,
        status: "playing"
      });
      setBotThinking(false);
    }, 650);

    return () => window.clearTimeout(timer);
  }, [botColor, difficulty, humanColor, match.board, match.status, match.turn]);

  function resetMatch() {
    setRound((current) => current + 1);
    setMatch(createMatchState());
    setBotThinking(false);
    setBotMatchId(createBotMatchId());
    botRecordedRef.current = null;
  }

  function commitMove(column: number) {
    if (match.status !== "playing" || match.turn !== humanColor || botThinking) {
      return;
    }

    const move = dropDisc(match.board, column, humanColor);

    if (!move) {
      return;
    }

    const nextBoard = move.board;
    const outcome = findWinner(nextBoard);

    if (outcome.kind === "win") {
      setMatch({
        board: nextBoard,
        turn: humanColor,
        winnerLine: outcome.line,
        result: `${colorLabel(outcome.winner)} победили`,
        outcome: outcome.winner === humanColor ? "win" : "loss",
        status: "won"
      });
      return;
    }

    if (outcome.kind === "draw") {
      setMatch({
        board: nextBoard,
        turn: humanColor,
        winnerLine: [],
        result: "Ничья",
        outcome: "draw",
        status: "draw"
      });
      return;
    }

    setMatch({
      board: nextBoard,
      turn: nextColor(humanColor),
      winnerLine: [],
      result: null,
      outcome: null,
      status: "playing"
    });
  }

  function switchDifficulty(nextDifficulty: BotDifficulty) {
    const params = new URLSearchParams(searchParams.toString());
    if (nextDifficulty === "normal") {
      params.delete("difficulty");
    } else {
      params.set("difficulty", nextDifficulty);
    }
    if (!params.get("mode")) {
      params.set("mode", "bot");
    }
    router.replace(`/game?${params.toString()}`);
    setStatusMessage(`Выбран режим: ${difficultyLabel(nextDifficulty)}.`);
    setRound(1);
    setMatch(createMatchState());
    setBotThinking(false);
    setBotMatchId(createBotMatchId());
    botRecordedRef.current = null;
  }

  const botStatus = showOutcome
    ? "Итог"
    : botThinking
      ? "Бот думает"
      : match.turn === humanColor
        ? "Ваш ход"
        : "Ход бота";

  return (
    <main className="page">
      <header className="topbar topbar--compact">
        <div>
          <p className="eyebrow eyebrow--accent">4 в ряд</p>
          <h1>{queueMode ? "Очередь и бот" : "Игра против бота"}</h1>
          <p className="lede">
            {queueMode
              ? "Пока очередь ищет соперника, можно играть с ботом. Как только найдём пару, переключим в живую комнату."
              : "Лёгкий, обычный или сложный бот."}
          </p>
        </div>

        <div className="topbar__actions">
          {queueMode ? <span className="status-pill">В очереди: {queueState.waitingCount}</span> : null}
          <Link href="/menu" className="ghost-button">
            Меню
          </Link>
          <Link href="/rating" className="ghost-button">
            Рейтинг
          </Link>
        </div>
      </header>

      <section className="workspace workspace--single">
        {queueMode ? (
          <aside className="sidebar">
            <section className="panel">
              <div className="panel__header">
                <div>
                  <p className="eyebrow">Очередь</p>
                  <h3>
                    {queueState.status === "matched"
                      ? "Соперник найден"
                      : queueState.status === "waiting"
                        ? "Ждём соперника"
                        : "Подбор соперника"}
                  </h3>
                </div>
                <span className="muted">{queueState.waitingCount} в очереди</span>
              </div>

              <p className="field__message">{statusMessage}</p>
              <p className="field__message">
                {queueState.status === "waiting"
                  ? queueState.queuePosition
                    ? `Место в очереди: ${queueState.queuePosition}`
                    : "Пока можно играть с ботом."
                  : "Как только найдём живого соперника, откроем комнату автоматически."}
              </p>

              <div className="field__actions">
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => cancelQueue().catch(() => undefined)}
                  disabled={queueBusy}
                >
                  Выйти из очереди
                </button>
              </div>
            </section>
          </aside>
        ) : null}

        <section className="board-area board-area--solo">
          <div className="board-stage">
            <div className="room-state-strip room-state-strip--solo">
              <span className="status-pill">Ваш цвет: красные</span>
              <span className="status-pill">
                Ход: {match.turn === humanColor ? "красные" : "зелёные"}
              </span>
              <span className="status-pill">Счёт: {sessionScore.player}-{sessionScore.bot}</span>
            </div>

            <div className="bot-difficulty-strip">
              <span className="muted bot-difficulty-strip__label">Сложность</span>
              <div className="bot-difficulty-grid">
                <button
                  type="button"
                  className={difficulty === "easy" ? "primary-button" : "ghost-button"}
                  onClick={() => switchDifficulty("easy")}
                >
                  Лёгкий
                </button>
                <button
                  type="button"
                  className={difficulty === "normal" ? "primary-button" : "ghost-button"}
                  onClick={() => switchDifficulty("normal")}
                >
                  Обычный
                </button>
                <button
                  type="button"
                  className={difficulty === "hard" ? "primary-button" : "ghost-button"}
                  onClick={() => switchDifficulty("hard")}
                >
                  Сложный
                </button>
              </div>
            </div>

            <ConnectFourBoard
              board={match.board}
              activeColor={match.turn}
              highlightLine={match.winnerLine}
              onColumnSelect={commitMove}
              disabled={match.status !== "playing" || match.turn !== humanColor || botThinking}
              statusLabel={botStatus}
            />

            {showOutcome ? (
              <div className="result-banner result-banner--floating">
                <div className="result-banner__copy">
                  <p className="result-banner__eyebrow">Игра окончена</p>
                  <h3>{match.result ?? "Партия завершена"}</h3>
                  <p>Победная комбинация остаётся на поле, чтобы её можно было разобрать сразу.</p>
                </div>
                <button type="button" className="primary-button" onClick={resetMatch}>
                  Новый раунд
                </button>
              </div>
            ) : null}
          </div>

          <div className="board-footer board-footer--solo">
            <div className="status-pill">Вы: {profile?.nickname ?? "Игрок"}</div>
            <div className="status-pill">Бот: зелёные</div>
            <div className="status-pill">Раунд {round}</div>
          </div>
        </section>
      </section>
    </main>
  );
}



