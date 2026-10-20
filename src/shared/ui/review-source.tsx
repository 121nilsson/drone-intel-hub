import { useState } from "react";
import { cn } from "@/lib/utils";
import { ExternalSourceLink, shortUrl } from "./links";
import { Btn } from "./primitives";

/**
 * The catalogue's source string is "Outlet · https://post". Split it so the URL can be a link
 * instead of flat text - a reviewer has to be able to open the post to judge a figure.
 */
function splitSource(source: string | undefined): { label: string; url?: string | undefined } {
  const s = (source ?? "").trim();
  const withUrl = s.match(/^(.*?)\s*·\s*(https?:\/\/\S+)$/);
  if (withUrl) return { label: withUrl[1]!.trim(), url: withUrl[2]! };
  if (/^https?:\/\//i.test(s)) return { label: shortUrl(s), url: s };
  return { label: s, url: undefined };
}

/** How much of the text is shown before it is cut. */
const PREVIEW = 400;

/**
 * The source of a claim or a fixture: the outlet, a link to the post, and the text the figure
 * was read from.
 *
 * The text is cut for the card, but never lost - a reviewer cannot tell a 600 km altitude from
 * a 600 km/h speed without reading the sentence, so the rest has to be one click away.
 */
export function ReviewSource({
  source,
  href,
  text,
  className,
  textClassName,
}: {
  source?: string | undefined;
  href?: string | undefined;
  text?: string | undefined;
  className?: string | undefined;
  textClassName?: string | undefined;
}) {
  const split = splitSource(source);
  const url = href || split.url;
  const label = url && !split.url ? shortUrl(url) : split.label;
  const [open, setOpen] = useState(false);
  const body = (text ?? "").trim();
  const cut = body.length > PREVIEW && !open;
  return (
    <div className={cn("space-y-1", className)}>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {url ? (
          <ExternalSourceLink href={url} className="font-mono text-xs">
            {label || shortUrl(url)}
          </ExternalSourceLink>
        ) : (
          <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">{label}</span>
        )}
      </div>
      {body && (
        <>
          <p
            className={cn("whitespace-pre-wrap break-words leading-relaxed", textClassName)}
            data-testid="review-source-text"
          >
            {cut ? `${body.slice(0, PREVIEW)}…` : body}
          </p>
          {body.length > PREVIEW && (
            <Btn
              type="button"
              variant="ghost"
              className="px-2 py-0.5 text-xs"
              onClick={() => setOpen((v) => !v)}
            >
              {open ? "Show less" : `Show all ${body.length} characters`}
            </Btn>
          )}
        </>
      )}
    </div>
  );
}
