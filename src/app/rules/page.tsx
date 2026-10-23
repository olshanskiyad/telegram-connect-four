import Link from "next/link";

import { PageShell } from "@/components/page-shell";

const RULES = [
  "поле 6х7",
  "ряды заполняются снизу вверх (жмёте на ряд и кружок вашего цвета падает туда)",
  "ваша задача собрать 4 подряд одного цвета (по диагонали тоже считается)",
  "3 режима: игра с ботом (тренировки с разной сложностью), приватная комната на двоих или случайный соперник"
];

export default function RulesPage() {
  return (
    <PageShell
      eyebrow="4 в ряд"
      title="Правила."
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
    >
      <section className="panel">
        <p className="field__message" style={{ marginBottom: "14px" }}>
          Всё просто (как крестики-нолики):
        </p>
        <ul className="rules-list">
          {RULES.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
      </section>
    </PageShell>
  );
}
