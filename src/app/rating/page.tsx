"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { CSSProperties } from "react";

import { PageShell } from "@/components/page-shell";
import type { RatingLeaderboardResponse } from "@/server/stats/types";

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatTime(value: string | null): string {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function metricStyle(): CSSProperties {
  return {
    display: "grid",
    gap: "0.25rem",
    padding: "0.95rem 1rem",
    borderRadius: "18px",
    border: "1px solid rgba(255, 255, 255, 0.08)",
    background: "rgba(255, 255, 255, 0.03)"
  };
}

function cellStyle(emphasis = false): CSSProperties {
  return {
    padding: "0.95rem 0.7rem",
    borderBottom: "1px solid rgba(255, 255, 255, 0.06)",
    color: "rgba(234, 240, 255, 0.9)",
    fontWeight: emphasis ? 700 : 500,
    verticalAlign: "top"
  };
}

export default function RatingPage() {
  const [rating, setRating] = useState<RatingLeaderboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function loadRating() {
      try {
        setError(null);
        const response = await fetch("/api/rating", {
          cache: "no-store",
          signal: controller.signal
        });

        if (!response.ok) {
          throw new Error("Не удалось загрузить рейтинг.");
        }

        const data = (await response.json()) as RatingLeaderboardResponse;
        setRating(data);
      } catch (loadError) {
        if ((loadError as Error).name === "AbortError") {
          return;
        }

        setError(loadError instanceof Error ? loadError.message : "Не удалось загрузить рейтинг.");
      }
    }

    void loadRating();

    return () => controller.abort();
  }, []);

  const summary = rating?.summary ?? null;
  const leaderboard = rating?.leaderboard ?? [];

  return (
    <PageShell
      eyebrow="Рейтинг"
      title="Таблица лидеров."
      actions={
        <>
          <Link href="/menu" className="ghost-button">
            В меню
          </Link>
          <Link href="/game?mode=bot" className="primary-button">
            Играть
          </Link>
        </>
      }
      sidebar={
        <section className="panel">
          <div className="panel__header">
            <div>
              <p className="eyebrow">Сводка</p>
              <h3>Рейтинг</h3>
            </div>
          </div>

          <div className="member-stack">
            <article className="member-card" style={metricStyle()}>
              <div>
                <strong>{summary ? summary.totalMatches : "-"}</strong>
                <p>Всего проведено игр</p>
              </div>
            </article>
            <article className="member-card" style={metricStyle()}>
              <div>
                <strong>{summary ? summary.playersTracked : "-"}</strong>
                <p>Всего игроков</p>
              </div>
            </article>
          </div>
        </section>
      }
    >
      <section className="panel">
        <div className="panel__header">
          <div>
            <p className="eyebrow">Лидеры</p>
            <h3>Общий рейтинг игроков</h3>
          </div>
          <span className="muted">{summary ? `Обновлено: ${formatTime(summary.updatedAt)}` : "Загрузка…"}</span>
        </div>

        {error ? <p className="field__message field__message--warning">{error}</p> : null}

        <div style={{ overflowX: "auto" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              minWidth: 720
            }}
          >
            <thead>
              <tr>
                {["#", "Игрок", "Победы", "Поражения", "Ничьи", "Матчи", "Процент побед", "Последняя игра"].map((label) => (
                  <th
                    key={label}
                    style={{
                      textAlign: "left",
                      padding: "0.8rem 0.7rem",
                      color: "rgba(234, 240, 255, 0.66)",
                      fontSize: "0.72rem",
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: "0.16em",
                      borderBottom: "1px solid rgba(255, 255, 255, 0.08)"
                    }}
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {leaderboard.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: "1.1rem 0.7rem", color: "rgba(219, 226, 255, 0.72)" }}>
                    Пока нет завершённых матчей. Сыграйте первую партию, и таблица появится здесь.
                  </td>
                </tr>
              ) : (
                leaderboard.map((row, index) => (
                  <tr key={`${index}-${row.nickname}`}>
                    <td style={cellStyle(true)}>{index + 1}</td>
                    <td style={cellStyle()}>
                      <strong style={{ color: "rgba(247, 249, 255, 0.98)", fontWeight: 700 }}>
                        {row.nickname || "Игрок"}
                      </strong>
                    </td>
                    <td style={cellStyle(row.wins > 0)}>{row.wins}</td>
                    <td style={cellStyle(row.losses > 0)}>{row.losses}</td>
                    <td style={cellStyle(row.draws > 0)}>{row.draws}</td>
                    <td style={cellStyle(row.gamesPlayed > 0)}>{row.gamesPlayed}</td>
                    <td style={cellStyle(row.winRate > 0)}>{formatPercent(row.winRate)}</td>
                    <td style={cellStyle(Boolean(row.lastMatchAt))}>{formatTime(row.lastMatchAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </PageShell>
  );
}
