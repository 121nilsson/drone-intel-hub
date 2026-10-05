import type { Drone, ExtractedSpec, SpecAttribute } from "@/entities/drone/types";

/** Merge extracted key-values into a drone's schema-less spec list; novel keys are created on the fly. */
export function mergeSpecs(drone: Drone, specs: ExtractedSpec[], source: string): Drone {
  const date = new Date().toISOString();
  const next: SpecAttribute[] = drone.specs.map((s) => ({ ...s, claims: [...s.claims] }));
  for (const e of specs) {
    const hit = next.find((s) => s.key === e.key);
    if (hit) hit.claims.push({ value: e.value, source, date });
    else next.push({ key: e.key, label: e.label, ...(e.unit ? { unit: e.unit } : {}), discoveredBy: "ai", claims: [{ value: e.value, source, date }] });
  }
  return { ...drone, specs: next, updatedAt: date };
}

export function allSpecKeys(drones: Drone[]) {
  const m = new Map<string, { label: string; count: number; discoveredBy: SpecAttribute["discoveredBy"] }>();
  drones.forEach((d) => d.specs.forEach((s) => {
    const cur = m.get(s.key);
    m.set(s.key, { label: s.label, count: (cur?.count ?? 0) + 1, discoveredBy: cur?.discoveredBy === "seed" ? "seed" : s.discoveredBy });
  }));
  return [...m.entries()].map(([key, v]) => ({ key, ...v }));
}
