import { Fragment } from "react";
import { parseSummary, type SummaryInline } from "./summary-markdown";

function Inline({ parts }: { parts: SummaryInline[] }) {
  return (
    <>
      {parts.map((p, i) =>
        p.bold ? (
          <strong key={i} className="font-semibold text-foreground">
            {p.text}
          </strong>
        ) : (
          <Fragment key={i}>{p.text}</Fragment>
        ),
      )}
    </>
  );
}

/** A generated summary as headed sections, bullets and paragraphs. */
export function SummaryText({ text }: { text: string }) {
  return (
    <div className="space-y-3 text-sm leading-relaxed text-foreground/90">
      {parseSummary(text).map((block, i) => {
        if (block.type === "heading")
          return (
            <h3
              key={i}
              className="pt-1 font-mono text-[11px] uppercase tracking-widest text-primary first:pt-0"
            >
              <Inline parts={block.inline} />
            </h3>
          );
        if (block.type === "list")
          return (
            <ul key={i} className="list-disc space-y-1 pl-5 marker:text-muted-foreground">
              {block.items.map((item, j) => (
                <li key={j}>
                  <Inline parts={item} />
                </li>
              ))}
            </ul>
          );
        return (
          <p key={i}>
            <Inline parts={block.inline} />
          </p>
        );
      })}
    </div>
  );
}
