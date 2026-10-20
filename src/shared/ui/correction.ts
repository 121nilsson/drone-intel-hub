import type { AutoCorrection } from "@/entities/drone/types";

/** "×1000" or "÷1000", whichever reads naturally. */
export function factorLabel(factor: number): string {
  return factor >= 1 ? `×${factor}` : `÷${Number((1 / factor).toPrecision(6))}`;
}

/** The chip mark: what the corrector found, and whether consensus uses it. */
export function correctionMark(fix: AutoCorrection): string {
  if (fix.kind === "implausible") return fix.applied ? "⚠ implausible" : "⚠? implausible";
  const v = `${fix.value} ${fix.unit ?? ""}`.trim();
  return fix.applied ? `↻ ${v}` : `↻? ${v}`;
}

/** One sentence on what the corrector found, for the provenance sheet and the review queue. */
export function describeCorrection(fix: AutoCorrection): string {
  const status = fix.applied
    ? "Applied automatically - consensus uses the corrected reading."
    : "Proposed - consensus still uses the figure as written until this kind of correction has earned analysts' trust.";
  if (fix.kind === "implausible")
    return `Outside what any system of this kind can do, and no unit slip explains it. ${status}`;
  const v = `${fix.value} ${fix.unit ?? ""}`.trim();
  const why =
    fix.basis === "consensus"
      ? `Off from what the other sources agree on by exactly ${factorLabel(fix.factor ?? 1)}`
      : `Physically out of range, and ${factorLabel(fix.factor ?? 1)} brings it in`;
  return `${why}: likely a unit slip for ${v}. ${status}`;
}
