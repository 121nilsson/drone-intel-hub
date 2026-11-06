import { Collapsible } from "@/shared/ui/collapsible";

/**
 * Plain text clamped to a few lines, with a toggle when it is longer: `Collapsible` around one
 * paragraph. `className` styles the text and sets the line height the clamp counts in.
 */
export function ExpandableText({
  text,
  className = "",
  clamp = 3,
}: {
  text: string;
  className?: string;
  clamp?: number;
}) {
  return (
    <Collapsible lines={clamp} className={className}>
      <p className="[overflow-wrap:anywhere]">{text}</p>
    </Collapsible>
  );
}
