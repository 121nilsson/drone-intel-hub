import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Btn } from "./primitives";

/**
 * Any content cut off after a number of lines, with "Show more" under it when it is longer and
 * nothing when it is not. The one place the app shortens long text: briefings, dossier briefs and
 * archived posts all use it, so the cut-off and the toggle behave the same everywhere.
 *
 * The height is `lines` times the line height of this element, so `className` should carry the
 * text size and leading of what is inside (`text-sm leading-relaxed`). Whether the content
 * overflows is measured, not guessed from its length, so a short text with many line breaks and a
 * long one on a wide screen are both judged by what they take on the screen.
 */
export function Collapsible({
  children,
  lines = 6,
  className,
  moreLabel = "Show more",
  lessLabel = "Show less",
}: {
  children: ReactNode;
  /** Lines shown while collapsed. */
  lines?: number;
  className?: string;
  moreLabel?: string;
  lessLabel?: string;
}) {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);

  useEffect(() => {
    const el = box.current;
    if (!el || expanded) return;
    const measure = () => setOverflowing(el.scrollHeight > el.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    // The box itself is capped, so its own size never changes: watch what is inside it.
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    for (const child of Array.from(el.children)) watch.observe(child);
    return () => watch.disconnect();
  }, [expanded, children, lines]);

  return (
    <div className="min-w-0">
      <div
        id={id}
        ref={box}
        className={cn("min-w-0", !expanded && "overflow-hidden", className)}
        style={expanded ? undefined : { maxHeight: `${lines}lh` }}
      >
        {children}
      </div>
      {(overflowing || expanded) && (
        <Btn
          size="sm"
          variant="quiet"
          className="-ml-2 mt-1"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? lessLabel : moreLabel}
        </Btn>
      )}
    </div>
  );
}
