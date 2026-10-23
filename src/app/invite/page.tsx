"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { PageShell } from "@/components/page-shell";
import { postJson } from "@/lib/api";
import { usePresenceCount } from "@/lib/presence";
import { useSession } from "@/lib/session";

type CreatedRoom = {
  inviteCode: string;
};

export default function InvitePage() {
  const router = useRouter();
  const session = useSession();
  const [message, setMessage] = useState("Создайте комнату и отправьте ссылку игроку.");
  const [busy, setBusy] = useState(false);
  const buttonLabel = busy ? "Создаём..." : "Создать комнату";
  const onlinePlayers = usePresenceCount(session.initData);

  useEffect(() => {
    if (session.status === "unavailable") {
      setMessage(session.error);
    } else if (session.status === "ready") {
      setMessage("Нажмите кнопку, чтобы создать комнату.");
    }
  }, [session.status, session.error]);

  async function createRoom() {
    if (busy) {
      return;
    }

    if (!session.initData) {
      setMessage(session.status === "loading" ? "Выполняем вход, секунду." : session.error);
      return;
    }

    setBusy(true);

    try {
      const payload = await postJson<{ room: CreatedRoom }>("/api/rooms", {
        initData: session.initData
      });

      router.push(`/room/${payload.room.inviteCode}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось создать комнату.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageShell
      eyebrow="Комната"
      title="Комната по ссылке."
      lede="Создайте игру и отправьте ссылку нужному человеку."
      actions={
        <>
          <span className="status-pill">Игроков онлайн: {onlinePlayers ?? "-"}</span>
          <Link href="/menu" className="ghost-button">
            В меню
          </Link>
          <button type="button" className="primary-button" onClick={() => createRoom().catch(() => undefined)}>
            {buttonLabel}
          </button>
        </>
      }
      sidebar={
        <section className="panel">
          <div className="panel__header">
            <div>
              <p className="eyebrow">Как это работает</p>
              <h3>1 × 1 по ссылке</h3>
            </div>
            <span className="muted">Приватный матч</span>
          </div>

          <div className="member-stack">
            <article className="member-card">
              <div>
                <strong>Создайте комнату</strong>
                <p>Ссылка появится сразу после нажатия кнопки.</p>
              </div>
            </article>
            <article className="member-card">
              <div>
                <strong>Передайте ссылку</strong>
                <p>Второй игрок откроет её на своём устройстве.</p>
              </div>
            </article>
            <article className="member-card">
              <div>
                <strong>Начните матч</strong>
                <p>Цвет выбирается перед стартом партии.</p>
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
            <h3>Создать ссылку</h3>
          </div>
          <span className="muted">Без лобби</span>
        </div>

        <p className="field__message">{message}</p>

        <div className="field__actions color-choice-grid">
          <button type="button" className="primary-button" onClick={() => createRoom().catch(() => undefined)}>
            {buttonLabel}
          </button>
          <Link href="/menu" className="ghost-button">
            Назад
          </Link>
        </div>
      </section>
    </PageShell>
  );
}
