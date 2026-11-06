import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface Column<T> {
  id: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** Column width as a CSS length ("24%", "7rem"); the table is fixed-layout when any is set. */
  width?: string;
  className?: string;
  align?: "left" | "right";
  /** Makes the header a sort button; the page owns the sort state and the sorting. */
  sort?: { direction: "asc" | "desc" | null; onSort: () => void };
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <span className="font-mono text-2xs uppercase tracking-widest text-accent">{children}</span>
  );
}

function HeaderCell<T>({ c }: { c: Column<T> }) {
  const dir = c.sort?.direction;
  return (
    <th
      scope="col"
      aria-sort={
        c.sort ? (dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none") : undefined
      }
      className={cn(
        "whitespace-nowrap px-3 py-2 font-mono text-2xs font-normal uppercase tracking-wider text-muted-foreground",
        c.align === "right" && "text-right",
        dir && "text-primary",
      )}
    >
      {c.sort ? (
        <button
          type="button"
          onClick={c.sort.onSort}
          className="inline-flex items-center gap-1 uppercase tracking-wider hover:text-primary"
        >
          {c.header}
          {dir && <span aria-hidden>{dir === "asc" ? "↑" : "↓"}</span>}
        </button>
      ) : (
        c.header
      )}
    </th>
  );
}

/**
 * The card a row becomes on a phone when the page does not draw one: the first column as the
 * title, every other column as a label and its value. Columns are the description of the row, so
 * a table that only gave columns still reads on a narrow screen.
 */
function RowCard<T>({ columns, row }: { columns: readonly Column<T>[]; row: T }) {
  const [first, ...rest] = columns;
  return (
    <div className="space-y-1.5">
      {first && <div className="font-medium">{first.cell(row)}</div>}
      <dl className="space-y-1 text-xs">
        {rest.map((c) => (
          <div key={c.id} className="flex items-baseline justify-between gap-3">
            <dt className="shrink-0 font-mono text-2xs uppercase tracking-wider text-muted-foreground">
              {c.header}
            </dt>
            <dd className="min-w-0 text-right">{c.cell(row)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/**
 * A table on wide screens and a list of cards below md: a phone gets one readable card per row
 * instead of a table it has to scroll sideways. Pages describe columns and may draw their own
 * `card`; without one the columns become a label-and-value card (`RowCard`), and `cards={false}`
 * keeps the table at every width for the rare table that is only meaningful as a grid. The layout,
 * header style and row rules live here once.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  card,
  cards = true,
  minWidth,
  label,
  testId,
  cardTestId,
  bare = false,
  sections,
}: {
  columns: readonly Column<T>[];
  rows: readonly T[];
  /**
   * Optional labelled groups of the same rows ("Performance", "Physical"). Every row still shows;
   * a heading row only says what the rows below it describe. Takes the place of `rows`.
   */
  sections?: readonly { id: string; label: string; rows: readonly T[] }[];
  rowKey: (row: T) => string;
  card?: (row: T) => ReactNode;
  /** False keeps the table at every width, with no cards (for a grid that only reads as a grid). */
  cards?: boolean;
  /** Below this width the table scrolls inside its frame rather than squeezing its columns. */
  minWidth?: string;
  label: string;
  testId?: string;
  cardTestId?: string;
  /** Inside a Panel: no frame of its own, rows divided by rules, so it is not a box in a box. */
  bare?: boolean;
}) {
  const fixed = columns.some((c) => c.width);
  const groups = sections ?? [{ id: "", label: "", rows }];
  const drawCard =
    card ?? (cards ? (row: T) => <RowCard columns={columns} row={row} /> : undefined);
  return (
    <>
      {drawCard && (
        <ul
          className={cn("md:hidden", bare ? "divide-y divide-border" : "space-y-2")}
          aria-label={label}
          data-testid={cardTestId}
        >
          {groups.map((g) => [
            g.label && (
              <li key={`h-${g.id}`} className="pb-1 pt-4 first:pt-0">
                <SectionLabel>{g.label}</SectionLabel>
              </li>
            ),
            ...g.rows.map((row) => (
              <li
                key={rowKey(row)}
                className={cn(
                  "min-w-0 [overflow-wrap:anywhere]",
                  bare ? "py-3 first:pt-0" : "border border-border bg-card/80 p-3",
                )}
              >
                {drawCard(row)}
              </li>
            )),
          ])}
        </ul>
      )}
      <div
        className={cn(
          "overflow-x-auto",
          !bare && "border border-border bg-card/80",
          drawCard && "hidden md:block",
        )}
      >
        <table
          className={cn(
            "w-full border-collapse text-sm",
            fixed && "table-fixed",
            // Bare tables align with the panel's own padding instead of indenting the edges.
            bare && "[&_:is(td,th):first-child]:pl-0 [&_:is(td,th):last-child]:pr-0",
          )}
          style={minWidth ? { minWidth } : undefined}
          aria-label={label}
          data-testid={testId}
        >
          {fixed && (
            <colgroup>
              {columns.map((c) => (
                <col key={c.id} style={c.width ? { width: c.width } : undefined} />
              ))}
            </colgroup>
          )}
          <thead>
            <tr className="border-b border-border text-left">
              {columns.map((c) => (
                <HeaderCell key={c.id} c={c} />
              ))}
            </tr>
          </thead>
          {groups.map((g) => (
            <tbody key={g.id} className="divide-y divide-border">
              {g.label && (
                <tr>
                  <th
                    colSpan={columns.length}
                    scope="colgroup"
                    className="px-3 pb-1 pt-5 text-left font-normal"
                  >
                    <SectionLabel>{g.label}</SectionLabel>
                  </th>
                </tr>
              )}
              {g.rows.map((row) => (
                <tr key={rowKey(row)} className="align-top transition-colors hover:bg-secondary/40">
                  {columns.map((c) => (
                    <td
                      key={c.id}
                      className={cn(
                        "min-w-0 px-3 py-2.5",
                        c.align === "right" && "text-right",
                        c.className,
                      )}
                    >
                      {c.cell(row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
    </>
  );
}
