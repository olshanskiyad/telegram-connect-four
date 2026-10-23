"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { postJson, requestJson } from "@/lib/api";
import { getPublicConfig } from "@/lib/config";
import { colorLabel, createBoard, type PlayerColor } from "@/lib/connect-four";
import { createLiveSocketUrl, safeParseJson } from "@/lib/live";
import { useSession } from "@/lib/session";
import { buildTelegramRoomLink } from "@/lib/telegram-links";
import type { RoomRole, RoomView } from "@/server/rooms/types";

import { ConnectFourBoard } from "./connect-four-board";

type RoomClientProps = {
  roomId: string;
  source?: "invite" | "random";
};

function roomStatusMessage(room: RoomView | null): string {
  if (!room) {
    return "Комната загружается...";
  }

  if (room.status === "lobby") {
    if (room.guest === null) {
      return "Поле готово. Скопируйте ссылку и пригласите соперника.";
    }

    return "Ждём выбора цвета.";
  }

  if (room.status === "active") {
    return "Игра идёт.";
  }

  return "Партия завершена.";
}

function resultLabel(room: RoomView | null): string {
  if (!room?.result) {
    return "";
  }

  if (room.result.kind === "draw") {
    return "Ничья";
  }

  const winner = colorLabel(room.result.winner);
  return `${winner.charAt(0).toUpperCase()}${winner.slice(1)} победили`;
}

function capitalizeColorLabel(color: PlayerColor): string {
  const label = colorLabel(color);
  return `${label.charAt(0).toUpperCase()}${label.slice(1)}`;
}

export function RoomClient({ roomId, source = "invite" }: RoomClientProps) {
  const router = useRouter();
  const session = useSession();
  const { initData } = session;
  const joinAttempted = useRef(false);
  const liveSocketRef = useRef<WebSocket | null>(null);
  const [liveSocketOpen, setLiveSocketOpen] = useState(false);
  const [room, setRoom] = useState<RoomView | null>(null);
  const [message, setMessage] = useState("Подключаем комнату...");
  const [busy, setBusy] = useState(false);
  const [copyToast, setCopyToast] = useState<string | null>(null);
  const viewerRef = useRef<{ telegramId: number; role: RoomRole } | null>(null);

  const playerName = session.profile?.nickname || "Игрок";
  const activeColor = room?.turnColor ?? null;
  const activeColorLabel =
    activeColor === "red" ? "Красные" : activeColor === "green" ? "Зелёные" : "не начат";
  const viewerColor = room?.viewer?.color ?? null;
  const viewerColorLabel =
    viewerColor === "red" ? "Красные" : viewerColor === "green" ? "Зелёные" : "не выбран";
  const turnColorLabel = activeColorLabel;
  const displayedPlayerCount = room ? Math.max(room.playerCount ?? 0, room.host ? 1 : 0, room.guest ? 2 : 0) : 0;
  const canMove = Boolean(
    room?.viewer?.color &&
      room?.turnColor &&
      room?.status === "active" &&
      room?.viewer?.color === room.turnColor
  );
  const roomResult = room?.result;
  const roomResultText = useMemo(() => resultLabel(room), [room]);
  const roomScoreLabel = useMemo(() => {
    if (!room) {
      return "0-0";
    }

    if (room.viewer?.role === "guest") {
      return `${room.score.guest}-${room.score.host}`;
    }

    return `${room.score.host}-${room.score.guest}`;
  }, [room]);
  const isColorChoiceLobby =
    source === "invite" &&
    room?.status === "lobby" &&
    room?.viewer?.role !== "spectator" &&
    room?.viewer?.color === null;
  const isWaitingLobby = room?.status === "lobby" && room?.guest === null && !isColorChoiceLobby;

  // HTTP answers say who the viewer is (the server checked the sign-in). WebSocket updates come without a viewer:
  // the role from the last HTTP answer is kept and the color is taken from hostColor or guestColor.
  const showRoom = useCallback((next: RoomView) => {
    if (next.viewer) {
      viewerRef.current = { telegramId: next.viewer.telegramId, role: next.viewer.role };
    }

    const known = viewerRef.current;
    const color = known?.role === "host" ? next.hostColor : known?.role === "guest" ? next.guestColor : null;

    setRoom(known ? { ...next, viewer: { ...known, color } } : next);
    setMessage(roomStatusMessage(next));
  }, []);

  const fetchRoom = useCallback(
    async (signal?: AbortSignal) => {
      const payload = await requestJson<{ room: RoomView }>(`/api/rooms/${roomId}`, {
        method: "GET",
        headers: initData ? { "x-init-data": initData } : undefined,
        signal
      });

      showRoom(payload.room);
    },
    [initData, roomId, showRoom]
  );

  const joinRoom = useCallback(async () => {
    const payload = await postJson<{ room: RoomView }>(`/api/rooms/${roomId}`, {
      action: "join",
      initData
    });

    showRoom(payload.room);
  }, [initData, roomId, showRoom]);

  useEffect(() => {
    if (!copyToast) {
      return;
    }

    const timer = window.setTimeout(() => {
      setCopyToast(null);
    }, 2200);

    return () => window.clearTimeout(timer);
  }, [copyToast]);

  useEffect(() => {
    if (session.status === "unavailable") {
      setMessage(session.error);
    } else if (session.status === "ready") {
      setMessage("Профиль загружен.");
    }
  }, [session.status, session.error]);

  useEffect(() => {
    if (!roomId || !initData || joinAttempted.current) {
      return;
    }

    joinAttempted.current = true;

    joinRoom()
      .then(() => fetchRoom())
      .catch((error) => {
        setMessage(error instanceof Error ? error.message : "Не удалось войти в комнату.");
      });
  }, [fetchRoom, initData, joinRoom, roomId]);

  useEffect(() => {
    if (!roomId || !initData || typeof window === "undefined") {
      return;
    }

    let cancelled = false;

    getPublicConfig()
      .then((config) => {
        if (cancelled) {
          return;
        }

        // Only the room code goes into the address: the server does not need to know who is watching.
        const socket = new WebSocket(createLiveSocketUrl({ roomId }, config.wsUrl));

        liveSocketRef.current = socket;
        setLiveSocketOpen(false);

        socket.onmessage = (event) => {
          const payload = safeParseJson<{ type: string; room?: RoomView | null }>(event.data);

          if (!payload || payload.type !== "room" || !payload.room) {
            return;
          }

          showRoom(payload.room);
        };

        socket.onopen = () => {
          setLiveSocketOpen(true);
        };

        socket.onerror = () => {
          // Polling (below) keeps the room up to date while the socket is not open.
        };

        socket.onclose = () => {
          setLiveSocketOpen(false);
          if (liveSocketRef.current === socket) {
            liveSocketRef.current = null;
          }
        };
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      liveSocketRef.current?.close();
      liveSocketRef.current = null;
    };
  }, [initData, roomId, showRoom]);

  useEffect(() => {
    if (!roomId || !initData) {
      return;
    }

    if (liveSocketOpen) {
      return;
    }

    const controller = new AbortController();
    const interval = window.setInterval(() => {
      fetchRoom(controller.signal).catch(() => undefined);
    }, 2500);

    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [fetchRoom, initData, liveSocketOpen, roomId]);

  async function chooseColor(color: PlayerColor | "random") {
    if (busy) {
      return;
    }

    setBusy(true);

    try {
      const payload = await postJson<{ room: RoomView }>(`/api/rooms/${roomId}`, {
        action: "color",
        initData,
        color
      });

      showRoom(payload.room);
      setMessage(
        payload.room.viewer?.color
          ? `Цвет закреплён: ${payload.room.viewer.color === "red" ? "красные" : "зелёные"}.`
          : "Цвет закреплён."
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось выбрать цвет.");
    } finally {
      setBusy(false);
    }
  }

  async function makeMove(column: number) {
    if (busy || !canMove) {
      return;
    }

    setBusy(true);

    try {
      const payload = await postJson<{ room: RoomView }>(`/api/rooms/${roomId}`, {
        action: "move",
        initData,
        column
      });

      showRoom(payload.room);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось сделать ход.");
    } finally {
      setBusy(false);
    }
  }

  async function copyRoomLink() {
    if (typeof window === "undefined") {
      return;
    }

    const roomCode = room?.inviteCode ?? roomId;
    const config = await getPublicConfig().catch(() => null);
    const telegramLink =
      session.guest || !config ? "" : buildTelegramRoomLink(config.botUsername, roomCode);
    const link = telegramLink || `${window.location.origin}/room/${encodeURIComponent(roomCode)}`;

    try {
      await window.navigator.clipboard.writeText(link);
      setMessage("Ссылка скопирована.");
      setCopyToast("Ссылка на комнату скопирована.");
    } catch {
      // The clipboard needs HTTPS or localhost; otherwise show the link to copy by hand.
      window.prompt("Ссылка на комнату", link);
    }
  }

  async function restartMatch() {
    if (busy) {
      return;
    }

    setBusy(true);

    try {
      const payload = await postJson<{ room: RoomView }>(`/api/rooms/${roomId}`, {
        action: "restart",
        initData
      });

      showRoom(payload.room);
      setMessage("Новый раунд готов.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось перезапустить матч.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page page--room">
      {copyToast ? <div className="copy-toast">{copyToast}</div> : null}
      <header className="topbar topbar--compact topbar--room">
        <div>
          <h1 className="room-topline">
            <span className="room-topline__accent">4 в ряд.</span>{" "}
            <span className="room-topline__title">
              {source === "random" ? "Случайный матч." : "Приватная комната."}
            </span>
          </h1>
        </div>

        <div className="topbar__actions">
          {source === "invite" ? (
            <button type="button" className="ghost-button" onClick={() => copyRoomLink().catch(() => undefined)}>
              Скопировать ссылку
            </button>
          ) : (
            <span className="status-pill">Рандомный подбор</span>
          )}
          <button type="button" className="ghost-button" onClick={() => router.replace("/menu")}>
            Выход в меню
          </button>
        </div>
      </header>

      <section className="workspace workspace--room">
        <aside className="sidebar">
          <section className="panel">
            <div className="panel__header">
              <div>
                <p className="eyebrow">Статус</p>
                <h3>
                  {room?.status === "lobby"
                    ? room?.guest === null
                      ? "Ждём второго игрока"
                      : "Ждём выбора цвета"
                    : room?.status === "active"
                      ? "Игра идёт"
                      : room?.status === "finished"
                        ? "Партия завершена"
                        : "Подключаемся"}
                </h3>
              </div>
              <span className="muted">{room?.inviteCode ?? roomId}</span>
            </div>

            <p className="field__message">{message}</p>
            {room?.result ? <p className="field__message">{roomResultText}</p> : null}
            <p className="field__message">
              Ваш цвет: <strong>{viewerColorLabel}</strong>
            </p>
            <p className="field__message">
              Ход: <strong>{turnColorLabel}</strong>
            </p>
          </section>

          <section className="panel">
            <div className="panel__header">
              <div>
                <p className="eyebrow">Игроки</p>
                <h3>{displayedPlayerCount} / 2</h3>
              </div>
              <span className="muted">{room?.spectatorCount ?? 0} зрителей</span>
            </div>

            <div className="member-stack">
              <article className="member-card">
                <div>
                  <strong>{room?.host?.nickname ?? "Хост"}</strong>
                  <p>Создатель комнаты</p>
                </div>
                <span className="status-pill">
                  {room?.hostColor === "red"
                    ? "Красные"
                    : room?.hostColor === "green"
                      ? "Зелёные"
                      : "Ожидание"}
                </span>
              </article>

              {room?.guest ? (
                <article className="member-card">
                  <div>
                    <strong>{room.guest.nickname}</strong>
                    <p>Второй игрок</p>
                  </div>
                  <span className="status-pill">
                    {room.guestColor === "red"
                      ? "Красные"
                      : room.guestColor === "green"
                        ? "Зелёные"
                        : "Ожидание"}
                  </span>
                </article>
              ) : null}

              {(room?.spectatorCount ?? 0) > 0 ? (
                <article className="member-card">
                  <div>
                    <strong>Зрители</strong>
                    <p>Наблюдают за матчем</p>
                  </div>
                  <span className="status-pill">{room?.spectatorCount ?? 0}</span>
                </article>
              ) : null}
            </div>

          </section>

        </aside>

        <section className="board-area">
          <div className="board-area__header">
            <div>
              <p className="eyebrow">Комната</p>
              <h2>Игра 4 в ряд по одной ссылке</h2>
            </div>

            <div className="board-area__meta">
              <span className="status-pill">Комната {room?.inviteCode ?? roomId}</span>
            </div>
          </div>

          <div className="board-stage">
            <div className="room-state-strip">
              <span className="status-pill">Ваш цвет: {viewerColorLabel}</span>
              <span className="status-pill">Ход: {turnColorLabel}</span>
              <span className="status-pill">Счёт: {roomScoreLabel}</span>
            </div>

            {source !== "random" && isColorChoiceLobby ? (
              <section className="room-callout room-callout--choice">
                <div className="room-callout__copy">
                  <p className="result-banner__eyebrow">Выбор цвета</p>
                  <h3>Кто первый нажмёт кнопку, тот закрепит цвет</h3>
                </div>
                <div className="room-callout__actions">
                  <div className="color-choice-grid">
                    <button type="button" className="primary-button" onClick={() => chooseColor("red")}>
                      Красные
                    </button>
                    <button type="button" className="primary-button" onClick={() => chooseColor("green")}>
                      Зелёные
                    </button>
                    <button type="button" className="ghost-button" onClick={() => chooseColor("random")}>
                      Случайный
                    </button>
                  </div>
                </div>
              </section>
            ) : null}

            {source === "invite" && isWaitingLobby ? (
              <section className="room-callout">
                <div className="room-callout__copy">
                  <p className="result-banner__eyebrow">Ждём игрока</p>
                  <h3>Ждём второго игрока</h3>
                </div>
              </section>
            ) : null}

            {source === "random" && isWaitingLobby ? (
              <section className="room-callout">
                <div className="room-callout__copy">
                  <p className="result-banner__eyebrow">Ждём соперника</p>
                  <h3>Пока можно сыграть с ботом</h3>
                </div>
                <div className="room-callout__actions">
                  <Link href="/game?mode=bot" className="ghost-button">
                    Играть с ботом
                  </Link>
                </div>
              </section>
            ) : null}

            <ConnectFourBoard
              board={room?.board ?? createBoard()}
              activeColor={activeColor}
              highlightLine={room?.result?.kind === "win" ? room.result.line : []}
              onColumnSelect={makeMove}
              disabled={!canMove || room?.status !== "active" || busy}
              statusLabel={
                canMove
                  ? "Ваш ход"
                  : room?.status === "lobby"
                    ? room?.guest === null
                      ? "Ждём второго игрока"
                      : "Выберите цвет и дождитесь старта"
                    : room?.status === "active"
                      ? "Ход соперника"
                      : "Партия завершена"
              }
            />

            {room?.status === "finished" ? (
              <div className="result-banner result-banner--floating">
                <div className="result-banner__copy">
                  <p className="result-banner__eyebrow">Игра окончена</p>
                  <h3>
                    {roomResult?.kind === "draw"
                      ? "Ничья"
                      : roomResult?.kind === "win"
                        ? `${capitalizeColorLabel(roomResult.winner)} победили`
                        : "Партия завершена"}
                  </h3>
                </div>
                <button type="button" className="primary-button" onClick={restartMatch}>
                  Новый раунд
                </button>
              </div>
            ) : null}
          </div>

          <div className="board-footer">
            <div className="status-pill">Вы: {playerName}</div>
          </div>
        </section>
      </section>
    </main>
  );
}


