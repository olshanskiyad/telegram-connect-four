import type { ReactNode } from "react";

type PageShellProps = {
  pageClassName?: string;
  eyebrow?: string;
  title?: string;
  lede?: string;
  actions?: ReactNode;
  sidebar?: ReactNode;
  children: ReactNode;
};

export function PageShell({
  pageClassName,
  eyebrow = "4 в ряд",
  title,
  lede,
  actions,
  sidebar,
  children
}: PageShellProps) {
  return (
    <main className={pageClassName ? `page ${pageClassName}` : "page"}>
      <header className="topbar">
        <div>
          {eyebrow ? <p className="eyebrow eyebrow--accent">{eyebrow}</p> : null}
          {title ? <h1>{title}</h1> : null}
          {lede ? <p className="lede">{lede}</p> : null}
        </div>

        {actions ? <div className="topbar__actions">{actions}</div> : null}
      </header>

      <section className="workspace">
        {sidebar ? <aside className="sidebar">{sidebar}</aside> : null}
        <section className="board-area">{children}</section>
      </section>
    </main>
  );
}
