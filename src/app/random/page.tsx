"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { PageShell } from "@/components/page-shell";
import { postJson } from "@/lib/api";
import { usePresenceCount } from "@/lib/presence";
import { useSession } from "@/lib/session";

type MatchmakingState = {
  status: "idle" | "waiting" | "matched";
  queuePosition: number | null;
  waitingCount: number;
  room: {
    inviteCode: string;
  } | null;
};

export default function RandomPage() {
  const router = useRouter();
  const session = useSession();
  const { initData } = session;
  const [matchmaking, setMatchmaking] = useState<MatchmakingState>({
    status: "idle",
    queuePosition: null,
    waitingCount: 0,
    room: null
  });
  const [message, setMessage] = useState("Встаньте в очередь и сразу откроется поле ожидания.");
  const [busy, setBusy] = useState(false);

  const syncStatus = useCallback(async () => {
    if (!initData) {
      return;
    }

    const payload = await postJson<{ matchmaking: MatchmakingState }>("/api/matchmaking", {
      action: "status",
      initData
    });

    setMatchmaking(payload.matchmaking);

    if (payload.matchmaking.status === "matched" && payload.matchmaking.room?.inviteCode) {
      router.push(`/room/${payload.matchmaking.room.inviteCode}?source=random`);
      return;
    }

    if (payload.matchmaking.status === "waiting") {
      router.push("/game?mode=bot&queue=1");
      return;
    }

    setMessage("Нажмите кнопку, чтобы войти в очередь.");
  }, [initData, router]);

  const onlinePlayers = usePresenceCount(initData);

  useEffect(() => {
    if (session.status === "unavailable") {
      setMessage(session.error);
    }
  }, [session.status, session.error]);

  useEffect(() => {
    if (!initData) {
      return;
    }

    void syncStatus();
    const timer = window.setInterval(() => {
      syncStatus().catch(() => undefined);
    }, 2500);

    return () => window.clearInterval(timer);
  }, [initData, syncStatus]);

  async function joinQueue() {
    if (busy) {
      return;
    }

    if (!initData) {
      setMessage(session.status === "loading" ? "Выполняем вход, секунду." : session.error);
      return;
    }

    setBusy(true);

    try {
      const payload = await postJson<{ matchmaking: MatchmakingState }>("/api/matchmaking", {
        action: "join",
        initData
      });

      setMatchmaking(payload.matchmaking);

      if (payload.matchmaking.room?.inviteCode) {
        router.push(`/room/${payload.matchmaking.room.inviteCode}?source=random`);
        return;
      }

      router.push("/game?mode=bot&queue=1");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось войти в очередь.");
    } finally {
      setBusy(false);
    }
  }

  async function cancelQueue() {
    if (busy) {
      return;
    }

    if (!initData) {
      setMessage(session.status === "loading" ? "Выполняем вход, секунду." : session.error);
      return;
    }

    setBusy(true);

    try {
      const payload = await postJson<{ matchmaking: MatchmakingState }>("/api/matchmaking", {
        action: "cancel",
        initData
      });

      setMatchmaking(payload.matchmaking);
      setMessage("Поиск отменён.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось отменить поиск.");
    } finally {
      setBusy(false);
    }
  }

  const waiting = matchmaking.status === "waiting";

  return (
    <PageShell
      eyebrow="Очередь"
      title="Случайный соперник."
      lede="Встаньте в очередь и ждите автоматического подбора. Если соперника нет, можно отменить поиск или сыграть с ботом."
      actions={
        <>
          <span className="status-pill">Игроков онлайн: {onlinePlayers ?? "-"}</span>
          <button
            type="button"
            className="ghost-button"
            onClick={() => {
              if (waiting) {
                void cancelQueue();
                return;
              }

              void joinQueue();
            }}
            disabled={busy}
          >
            {waiting ? "Выйти из очереди" : "Встать в очередь"}
          </button>
          <Link href="/menu" className="ghost-button">
            В меню
          </Link>
        </>
      }
      sidebar={
        <section className="panel">
          <div className="panel__header">
            <div>
              <p className="eyebrow">Подбор</p>
              <h3>{waiting ? "Вы в очереди" : "Случайный подбор"}</h3>
            </div>
            <span className="muted">{matchmaking.waitingCount} в очереди</span>
          </div>

          <div className="member-stack">
            <article className="member-card">
              <div>
                <strong>1. Встать в очередь</strong>
                <p>Вы попадаете в общий список ожидания.</p>
              </div>
            </article>
            <article className="member-card">
              <div>
                <strong>2. Подождать соперника</strong>
                <p>Когда появится второй игрок, игра откроется автоматически.</p>
              </div>
            </article>
            <article className="member-card">
              <div>
                <strong>3. Не ждать</strong>
                <p>Пока ждёте, можно сразу сыграть с ботом.</p>
              </div>
            </article>
          </div>
        </section>
      }
    >
      <section className="panel">
        <div className="panel__header">
          <div>
            <p className="eyebrow">Действие</p>
            <h3>{waiting ? "Вы в очереди" : "Войти в очередь"}</h3>
          </div>
          <span className="muted">Рандом</span>
        </div>

        <p className="field__message">{message}</p>
        <p className="field__message">Никнейм: {session.profile?.nickname ?? "Игрок"}</p>
        <p className="field__message">В очереди сейчас: {matchmaking.waitingCount}</p>
        {waiting && matchmaking.queuePosition ? (
          <p className="field__message">Место в очереди: {matchmaking.queuePosition}</p>
        ) : null}

        <div className="field__actions action-grid">
          {waiting ? (
            <button type="button" className="primary-button" onClick={() => cancelQueue().catch(() => undefined)}>
              Выйти из очереди
            </button>
          ) : (
            <button type="button" className="primary-button" onClick={() => joinQueue().catch(() => undefined)}>
              Встать в очередь
            </button>
          )}
          <Link href="/invite" className="ghost-button">
            Комната по ссылке
          </Link>
          <Link href="/game?mode=bot" className="ghost-button">
            Играть с ботом
          </Link>
        </div>
      </section>
    </PageShell>
  );
}
