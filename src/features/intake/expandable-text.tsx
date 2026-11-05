import { useState } from "react";
import { Btn } from "@/shared/ui/primitives";

export function ExpandableText({ text, className = "" }: { text: string; className?: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = text.length > 200;
  return (
    <div className="min-w-0">
      <p className={`break-words ${className} ${!expanded && isLong ? "line-clamp-3" : ""}`}>
        {text}
      </p>
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
