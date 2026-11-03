/**
 * Whether a figure belongs to the target its attribute is about. A sentence that lists ranges
 * per target - "micro drones as far away as three km, pedestrians beyond six kilometers and
 * vehicles at over 12 kilometers" - gives an extractor three figures for one attribute, and the
 * vehicles' 12 km read as the micro-drone detection range is a right figure for a wrong target.
 *
 * Pure and deliberately quiet: it speaks only when the attribute names a target and the clause
 * around the figure names one too. A clause naming no target says nothing, so a plain "detection
 * range of 5 km" is never downgraded by it.
 */

type TargetClass = "uav" | "person" | "vehicle" | "aircraft" | "vessel" | "missile";

/** Target words by class, English, Ukrainian and Russian stems; matched at a word start. */
const TARGETS: ReadonlyArray<readonly [TargetClass, RegExp]> = [
  [
    "uav",
    /(?<!\p{L})(?:micro[-_ ]?drones?|mini[-_ ]?drones?|drones?|uavs?|uas|suas|quadcopters?|fpv|дрон|безпілотн|беспилотн|бпла|бплa)/iu,
  ],
  [
    "person",
    /(?<!\p{L})(?:pedestrians?|people|persons?|personnel|humans?|infantry|soldiers?|troops|walking|піхот|людин|людей|пішох|человек|людей|пехот|пешеход)/iu,
  ],
  [
    "vehicle",
    /(?<!\p{L})(?:vehicles?|cars?|trucks?|tanks?|armou?red|apcs?|техні|машин|автомоб|танк|бронетех|транспорт)/iu,
  ],
  [
    "aircraft",
    /(?<!\p{L})(?:aircraft|airplanes?|planes?|helicopters?|jets?|fighters?|літак|гелікопт|вертол|самол)/iu,
  ],
  ["vessel", /(?<!\p{L})(?:boats?|ships?|vessels?|катер|корабл|судн|суд[аов])/iu],
  ["missile", /(?<!\p{L})(?:missiles?|ракет)/iu],
];

/** The classes a text names, by its target words. */
function targetsIn(raw: string): Set<TargetClass> {
  // "Unmanned aerial vehicles" are drones, not the vehicles a ground radar sees.
  const text = raw.replace(/(?:unmanned\s+)?aerial\s+vehicles?/giu, " uav ");
  const out = new Set<TargetClass>();
  for (const [cls, re] of TARGETS) if (re.test(text)) out.add(cls);
  return out;
}

/** The target an attribute is about, from its key and label: "detection_range_micro_drones". */
export function attributeTarget(spec: { key: string; label?: string }): TargetClass | undefined {
  const text = `${spec.key} ${spec.label ?? ""}`.replace(/_/g, " ");
  const found = targetsIn(text);
  // An attribute about two targets ("drone vs vehicle range") has no one target to hold it to.
  return found.size === 1 ? [...found][0] : undefined;
}

/** Where a list of targets breaks into its items: commas, semicolons and "and"/"while". */
const ITEM_BREAK =
  /[;:]|,(?!\d)|\s(?:and|while|whereas|but|or|та|і|й|а|и|но|или|або)\s|\s[–—-]\s/iu;

/** The item of the passage that holds the figure: from the break before it to the break after. */
function clauseAround(passage: string, at: number, length: number): string {
  const before = passage.slice(0, at);
  const after = passage.slice(at + length);
  const breaks = [...before.matchAll(new RegExp(ITEM_BREAK, "giu"))];
  const start = breaks.length
    ? breaks[breaks.length - 1]!.index! + breaks[breaks.length - 1]![0].length
    : 0;
  const next = after.search(ITEM_BREAK);
  return passage.slice(start, at + length + (next < 0 ? after.length : next));
}

/** The number a value states, as the post writes digits: "12 kilometers" → "12". */
const figureDigits = (value: string) => value.match(/\d+(?:[.,]\d+)*/)?.[0];

export type TargetVerdict =
  | { applicable: false }
  | { applicable: true; verdict: "pass" | "fail"; detail: string; clause: string };

/**
 * The figure's own clause, judged against the attribute's target. `passage` is the sentence the
 * claim was found in (or its quote when the post is not to hand).
 */
export function targetVerdict(
  spec: { key: string; label?: string },
  value: string,
  passage: string,
): TargetVerdict {
  const target = attributeTarget(spec);
  const digits = figureDigits(value);
  if (!target || !digits) return { applicable: false };
  const at = passage.search(new RegExp(`(?<![\\d.,])${digits.replace(/[.,]/g, "[.,]")}(?![\\d])`));
  if (at < 0) return { applicable: false };
  const clause = clauseAround(passage, at, digits.length).trim();
  const named = targetsIn(clause);
  if (!named.size) return { applicable: false };
  if (named.has(target))
    return {
      applicable: true,
      verdict: "pass",
      detail: "the figure's clause names its target",
      clause,
    };
  return {
    applicable: true,
    verdict: "fail",
    detail: `the figure's clause is about ${[...named].join(", ")}, not ${target}`,
    clause,
  };
}
