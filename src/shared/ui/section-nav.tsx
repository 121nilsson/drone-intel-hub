import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Sticky jump links for a long page. One line that scrolls sideways on a phone instead of
 * wrapping into a block, and the section in view is marked, so the bar also says where you are.
 */
export function SectionNav({
  sections,
  label,
}: {
  sections: readonly { id: string; label: string }[];
  label: string;
}) {
  const [current, setCurrent] = useState<string | null>(null);
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const visible = new Map<string, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries)
          visible.set(e.target.id, e.isIntersecting ? e.boundingClientRect.top : Infinity);
        const top = [...visible.entries()]
          .filter(([, y]) => y !== Infinity)
          .sort((a, b) => a[1] - b[1])[0];
        if (top) setCurrent(top[0]);
      },
      // The band below the sticky header and this bar: a section counts once its top reaches it.
      { rootMargin: "-110px 0px -55% 0px" },
    );
    for (const s of sections) {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [sections]);
  return (
    <nav
      aria-label={label}
      className="sticky top-14 z-20 -mx-4 border-y border-border bg-background/95 px-4 backdrop-blur sm:mx-0 sm:px-0"
    >
      <div className="flex gap-1 overflow-x-auto py-1.5 [scrollbar-width:none]">
        {sections.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            aria-current={current === s.id ? "location" : undefined}
            className={cn(
              "shrink-0 whitespace-nowrap px-2 py-1 font-mono text-2xs transition-colors pointer-coarse:py-2",
              current === s.id
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {s.label}
          </a>
        ))}
      </div>
    </nav>
  );
}
