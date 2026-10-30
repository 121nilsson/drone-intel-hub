import { useState, type ReactNode } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { Btn, Eyebrow } from "./primitives";

/** One toggleable filter value. Pressed state is announced, not only coloured. */
export function FilterChip({
  pressed,
  onClick,
  children,
  title,
}: {
  pressed: boolean;
  onClick: () => void;
  children: ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      title={title}
      className={cn(
        "inline-flex min-w-0 max-w-full items-center border px-2 py-0.5 font-mono text-xs transition-colors pointer-coarse:min-h-8",
        pressed
          ? "border-primary bg-primary/15 text-primary"
          : "border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground",
      )}
    >
      <span className="min-w-0 truncate">{children}</span>
    </button>
  );
}

/**
 * A labelled group of filter chips. Long lists (a hundred operator countries) show the first
 * `limit` options - callers order them by how often they occur - plus whatever is selected,
 * and open fully on request with a box to narrow them. A filter list the analyst has to scroll
 * past is a filter list nobody uses.
 */
export function FacetGroup({
  label,
  options,
  value,
  onToggle,
  render,
  searchText = (o) => o,
  limit = 12,
}: {
  label: string;
  options: readonly string[];
  value: readonly string[];
  onToggle: (option: string) => void;
  render?: (option: string) => ReactNode;
  searchText?: (option: string) => string;
  limit?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  if (!options.length) return null;
  const overflow = options.length > limit;
  const needle = query.trim().toLowerCase();
  const head = options.slice(0, limit);
  // Collapsed: the most frequent options plus anything selected. Opened: every option in
  // alphabetical order, which is how a long list is scanned for a known name.
  const shown = expanded
    ? options
        .filter((o) => !needle || searchText(o).toLowerCase().includes(needle))
        .sort((a, b) => searchText(a).localeCompare(searchText(b)))
    : [...head, ...value.filter((v) => !head.includes(v))];
  return (
    <fieldset className="min-w-0">
      <legend className="mb-2 flex w-full items-baseline justify-between gap-2">
        <Eyebrow>{label}</Eyebrow>
        {value.length > 0 && (
          <span className="font-mono text-2xs text-primary">{value.length} on</span>
        )}
      </legend>
      {expanded && options.length > 2 * limit && (
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Filter ${label.toLowerCase()}…`}
          aria-label={`Filter ${label.toLowerCase()} options`}
          className="mb-2 w-full border border-border bg-card px-2 py-1 font-mono text-xs focus:border-primary pointer-coarse:min-h-9"
        />
      )}
      <div className="flex flex-wrap gap-1.5">
        {shown.map((o) => (
          <FilterChip key={o} pressed={value.includes(o)} onClick={() => onToggle(o)}>
            {render ? render(o) : o}
          </FilterChip>
        ))}
        {expanded && !shown.length && (
          <span className="text-xs text-muted-foreground">No option matches.</span>
        )}
      </div>
      {overflow && (
        <button
          type="button"
          onClick={() => {
            setExpanded((v) => !v);
            setQuery("");
          }}
          aria-expanded={expanded}
          className="mt-2 font-mono text-2xs text-primary hover:underline"
        >
          {expanded ? "Show fewer" : `Show all ${options.length}`}
        </button>
      )}
    </fieldset>
  );
}

export interface ActiveFilter {
  id: string;
  label: ReactNode;
  /** Plain text for the remove button's accessible name. */
  text: string;
  clear: () => void;
}

/** The filters in force, each removable, so the view explains itself without the sidebar. */
export function ActiveFilters({
  filters,
  onClearAll,
}: {
  filters: readonly ActiveFilter[];
  onClearAll: () => void;
}) {
  if (!filters.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {filters.map((f) => (
        <button
          key={f.id}
          type="button"
          onClick={f.clear}
          aria-label={`Remove filter: ${f.text}`}
          className="inline-flex min-w-0 max-w-full items-center gap-1 border border-primary/40 bg-primary/10 px-2 py-0.5 font-mono text-2xs text-primary hover:bg-primary/15 pointer-coarse:min-h-8"
        >
          <span className="min-w-0 truncate">{f.label}</span>
          <X className="size-3 shrink-0" aria-hidden />
        </button>
      ))}
      {filters.length > 1 && (
        <button
          type="button"
          onClick={onClearAll}
          className="px-1 font-mono text-2xs text-muted-foreground hover:text-foreground"
        >
          Clear all
        </button>
      )}
    </div>
  );
}

/**
 * Filters beside the results on wide screens; on phones and tablets the same panel opens as a
 * bottom sheet from a "Filters" button, so the results start at the top of the page instead of
 * under a hundred chips.
 */
export function FilterLayout({
  filters,
  activeCount,
  onClear,
  resultLabel,
  children,
}: {
  filters: ReactNode;
  activeCount: number;
  onClear?: () => void;
  /** Shown on the sheet's close button ("Show 42 systems"), so the analyst sees the effect. */
  resultLabel: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const header = (
    <div className="flex items-center justify-between gap-2">
      <Eyebrow>Filters</Eyebrow>
      {activeCount > 0 && onClear && (
        <button
          type="button"
          onClick={onClear}
          className="font-mono text-2xs text-primary hover:underline"
        >
          Clear {activeCount}
        </button>
      )}
    </div>
  );
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-6">
      <aside
        aria-label="Filters"
        className="hidden min-w-0 space-y-5 self-start border border-border bg-card/60 p-4 lg:sticky lg:top-20 lg:block lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto"
      >
        {header}
        {filters}
      </aside>
      <div className="min-w-0 space-y-3">
        <Btn
          variant="ghost"
          className="w-full justify-between lg:hidden"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
        >
          <span className="inline-flex items-center gap-2">
            <SlidersHorizontal className="size-3.5" aria-hidden />
            Filters
          </span>
          {activeCount > 0 && <span className="text-primary">{activeCount} active</span>}
        </Btn>
        {children}
      </div>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="bottom"
          className="flex max-h-[85vh] flex-col gap-0 border-border bg-card p-0 lg:hidden"
        >
          <div className="border-b border-border px-4 py-3 pr-12">
            <SheetTitle className="font-mono text-xs uppercase tracking-widest">Filters</SheetTitle>
            <SheetDescription className="sr-only">Narrow the list below.</SheetDescription>
          </div>
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">{filters}</div>
          <div className="flex gap-2 border-t border-border px-4 py-3">
            {activeCount > 0 && onClear && (
              <Btn variant="ghost" onClick={onClear}>
                Clear
              </Btn>
            )}
            <Btn className="flex-1 justify-center" onClick={() => setOpen(false)}>
              {resultLabel}
            </Btn>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
