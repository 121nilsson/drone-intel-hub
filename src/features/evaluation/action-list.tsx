import type { ReactNode } from "react";

/**
 * Buttons with what each one does beside it, so an analyst can tell which to press without
 * hovering for a tooltip or reading the code.
 */
export function ActionList({ items }: { items: { button: ReactNode; does: ReactNode }[] }) {
  return (
    <ul className="divide-y divide-border border-y border-border">
      {items.map((item, i) => (
        <li
          key={i}
          className="grid gap-x-4 gap-y-1 py-2 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] sm:items-center"
        >
          <div className="min-w-0">{item.button}</div>
          <p className="min-w-0 text-xs text-muted-foreground">{item.does}</p>
        </li>
      ))}
    </ul>
  );
}

/** One of the page's three stages: a numbered heading, what the stage is for, then its panels. */
export function Stage({
  id,
  n,
  title,
  purpose,
  children,
}: {
  id: string;
  n: number;
  title: string;
  purpose: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-20 space-y-4" aria-labelledby={`${id}-title`}>
      <header className="border-l-2 border-primary pl-3">
        <h2 id={`${id}-title`} className="text-lg font-semibold">
          <span className="mr-2 font-mono text-primary">{n}</span>
          {title}
        </h2>
        <p className="mt-0.5 text-sm text-muted-foreground">{purpose}</p>
      </header>
      {children}
    </section>
  );
}
