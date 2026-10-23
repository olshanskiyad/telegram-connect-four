"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { PageShell } from "@/components/page-shell";
import { postJson } from "@/lib/api";
import { NICKNAME_MAX_LENGTH, validateNickname } from "@/lib/profile";
import { usePresenceCount } from "@/lib/presence";
import { useSession, type SessionProfile } from "@/lib/session";
import { getTelegramInitData, getTelegramStartParam } from "@/lib/telegram-webapp";

function profileDisplayName(profile: SessionProfile | null): string {
  return profile?.nickname || "Игрок";
}

function compactProfileGreeting(name: string): string {
  if (name.length <= NICKNAME_MAX_LENGTH) {
    return name;
  }

  return name.slice(0, NICKNAME_MAX_LENGTH);
}

const MODE_LINKS = [
  {
    href: "/game?mode=bot",
    title: "Игра с ботом",
    description: "Быстрая одиночная партия для проверки поля и логики."
  },
  {
    href: "/invite",
    title: "Комната по ссылке",
    description: "Приватная игра с нужным человеком по приглашению."
  },
  {
    href: "/random",
    title: "Случайный соперник",
    description: "Подбор пары через очередь."
  }
];

export default function MenuPage() {
  const router = useRouter();
  const session = useSession();
  const [nicknameDraft, setNicknameDraft] = useState("Игрок");
  const [isProfileDialogOpen, setIsProfileDialogOpen] = useState(false);
  const [statusMessage, setStatusMessage] = useState("Никнейм используется в игре и рейтинге.");

  const displayName = profileDisplayName(session.profile);
  const onlinePlayers = usePresenceCount(session.initData);

  useEffect(() => {
    const startParam = getTelegramStartParam();

    if (getTelegramInitData() && startParam.startsWith("room-")) {
      router.replace(`/room/${startParam.slice("room-".length)}`);
    }
  }, [router]);

  useEffect(() => {
    if (session.profile) {
      setNicknameDraft(session.profile.nickname);
    }
  }, [session.profile]);

  useEffect(() => {
    if (session.status === "ready") {
      setStatusMessage(
        session.guest
          ? "Гостевой профиль хранится в этом браузере."
          : "Профиль синхронизирован с Telegram."
      );
    }
  }, [session.status, session.guest]);

  function saveNickname() {
    const result = validateNickname(nicknameDraft);

    if (!result.valid) {
      setStatusMessage(result.message ?? "Никнейм не прошёл проверку.");
      return;
    }

    if (!session.initData) {
      setNicknameDraft(result.nickname);
      setStatusMessage("Никнейм сохранён локально.");
      return;
    }

    postJson<{ profile: SessionProfile }>("/api/profile", {
      initData: session.initData,
      nickname: result.nickname
    })
      .then((payload) => {
        session.setProfile(payload.profile);
        setNicknameDraft(payload.profile.nickname);
        setStatusMessage("Никнейм сохранён.");
      })
      .catch((error) => {
        setStatusMessage(error instanceof Error ? error.message : "Не удалось сохранить никнейм.");
      });
  }

  return (
    <PageShell
      pageClassName="page--menu"
      eyebrow="4 в ряд"
      actions={
        <>
          <span className="status-pill">Игроков онлайн: {onlinePlayers ?? "-"}</span>
          <Link href="/rules" className="ghost-button">
            Правила
          </Link>
          <button type="button" className="profile-chip" onClick={() => setIsProfileDialogOpen(true)}>
            Привет, {compactProfileGreeting(displayName)}!
          </button>
          <Link href="/rating" className="ghost-button">
            Рейтинг
          </Link>
        </>
      }
    >
      <section className="panel panel--modes">
        <div className="panel__header">
          <div>
            <h3>Выбери режим:</h3>
          </div>
        </div>

        {session.guest ? (
          <p className="field__message field__message--tight">Вы играете как гость: профиль и рейтинг привязаны к этому браузеру.</p>
        ) : null}
        {session.status === "unavailable" ? (
          <p className="field__message field__message--tight field__message--warning">
            {session.error} Партия с ботом доступна без входа.
          </p>
        ) : null}

        <div className="mode-grid">
          {MODE_LINKS.map((item) => (
            <Link key={item.href} href={item.href} className="mode-card">
              <span className="mode-card__title">{item.title}</span>
              <span className="mode-card__description">{item.description}</span>
            </Link>
          ))}
        </div>
      </section>

      {isProfileDialogOpen ? (
        <div className="profile-modal" role="presentation" onClick={() => setIsProfileDialogOpen(false)}>
          <section
            className="profile-modal__panel panel"
            role="dialog"
            aria-modal="true"
            aria-label="Редактирование никнейма"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="panel__header panel__header--compact">
              <div>
                <p className="eyebrow">Профиль</p>
                <h3>{displayName}</h3>
              </div>
              <button type="button" className="ghost-button ghost-button--compact" onClick={() => setIsProfileDialogOpen(false)}>
                Закрыть
              </button>
            </div>

            <p className="field__message field__message--tight">Имя для игры и рейтинга.</p>

            <label className="field">
              <span className="field__label">Никнейм</span>
              <input
                value={nicknameDraft}
                onChange={(event) => setNicknameDraft(event.target.value)}
                className="field__input"
                maxLength={NICKNAME_MAX_LENGTH}
                placeholder="Например, Алекс"
              />
            </label>

            <div className="field__actions">
              <button
                type="button"
                className="primary-button"
                onClick={() => {
                  saveNickname();
                  setIsProfileDialogOpen(false);
                }}
              >
                Сохранить
              </button>
              <p className="field__message">{statusMessage}</p>
            </div>
          </section>
        </div>
      ) : null}
    </PageShell>
  );
}
