import type { SpecAttribute } from "./types";
import { attributeSemantic } from "./spec-engine";

/**
 * How a system's specifications are read: grouped by what they describe and ordered so the
 * figures an analyst compares first come first. Nothing is dropped - an attribute whose semantic
 * no group claims (a fleet size, a production volume) still shows, under "Programme and other".
 */
export const SPEC_GROUPS = [
  {
    id: "performance",
    label: "Performance",
    prefixes: ["range.", "speed.", "endurance.", "altitude."],
  },
  {
    id: "physical",
    label: "Physical",
    prefixes: ["dimension.", "weight.", "propulsion.", "power.", "capacity.fuel"],
  },
  {
    id: "payload",
    label: "Payload, sensors and guidance",
    prefixes: ["payload.", "sensor.", "launcher.", "ew.", "guidance.", "capacity."],
  },
  { id: "cost", label: "Cost", prefixes: ["cost."] },
] as const;

export type SpecGroupId = (typeof SPEC_GROUPS)[number]["id"] | "other";

/**
 * The figures that best say what a system is, in the order a list should show one: reach first,
 * then speed, endurance and what it carries. A headline drawn from `specs[0]` showed whatever was
 * extracted first - a contract value or a "residual capability" year.
 */
const HEADLINE_ORDER = [
  "range.max",
  "range.operational",
  "range.combat",
  "range.engagement",
  "range.detection",
  "speed.max",
  "speed.cruise",
  "speed.stated",
  "endurance.flight",
  "payload.capacity",
  "payload.warhead",
  "altitude.max",
  "altitude.service_ceiling",
  "weight.mtow",
  "weight.launch",
];

export function specGroupOf(semantic: string): SpecGroupId {
  for (const g of SPEC_GROUPS)
    if (g.prefixes.some((p) => (p.endsWith(".") ? semantic.startsWith(p) : semantic === p)))
      return g.id;
  return "other";
}

const rank = (semantic: string) => {
  const i = HEADLINE_ORDER.indexOf(semantic);
  return i === -1 ? HEADLINE_ORDER.length : i;
};

/** The `n` best-known defining figures, best first; only ranked ones, never a programme figure. */
export function topSpecs(specs: readonly SpecAttribute[], n: number): SpecAttribute[] {
  return specs
    .map((s) => ({ s, r: rank(attributeSemantic(s)) }))
    .filter((x) => x.r < HEADLINE_ORDER.length)
    .sort((a, b) => a.r - b.r)
    .slice(0, n)
    .map((x) => x.s);
}

/** The spec a one-line summary should show, or undefined when the system has no ranked figure. */
export function headlineSpec(specs: readonly SpecAttribute[]): SpecAttribute | undefined {
  let best: SpecAttribute | undefined;
  let bestRank = HEADLINE_ORDER.length;
  for (const s of specs) {
    const r = rank(attributeSemantic(s));
    if (r < bestRank) {
      best = s;
      bestRank = r;
    }
  }
  return best;
}

/**
 * Every spec, in its group, groups in reading order and the best-known figures first within each.
 * Empty groups are left out.
 */
export function groupSpecs(
  specs: readonly SpecAttribute[],
): { id: SpecGroupId; label: string; specs: SpecAttribute[] }[] {
  const groups = [
    ...SPEC_GROUPS.map((g) => ({ id: g.id, label: g.label })),
    { id: "other" as const, label: "Programme and other" },
  ];
  const by = new Map<SpecGroupId, SpecAttribute[]>();
  for (const s of specs) {
    const id = specGroupOf(attributeSemantic(s));
    by.set(id, [...(by.get(id) ?? []), s]);
  }
  return groups
    .map((g) => ({
      ...g,
      // Stable within equal rank, so the stored order still decides among the unranked.
      specs: [...(by.get(g.id) ?? [])].sort(
        (a, b) => rank(attributeSemantic(a)) - rank(attributeSemantic(b)),
      ),
    }))
    .filter((g) => g.specs.length > 0);
}
