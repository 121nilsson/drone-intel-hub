import { useState } from "react";
import { Btn } from "@/shared/ui/primitives";

/**
 * Text clamped to a few lines, with a toggle when it is long. `clamp` is the line count shown
 * while collapsed; the classes are literal so Tailwind's scanner sees them.
 */
export function ExpandableText({
  text,
  className = "",
  clamp = 3,
}: {
  text: string;
  className?: string;
  clamp?: 3 | 4;
}) {
  const [expanded, setExpanded] = useState(false);
  const isLong = text.length > 200;
  const clampClass = clamp === 4 ? "line-clamp-4" : "line-clamp-3";
  return (
    <div className="min-w-0">
      <p className={`break-words ${className} ${!expanded && isLong ? clampClass : ""}`}>{text}</p>
      {isLong && (
        <Btn
          size="sm"
          variant="quiet"
          className="-ml-2 mt-1"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Show less" : "Show more"}
        </Btn>
      )}
    </div>
  );
}
