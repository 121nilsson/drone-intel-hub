import type { Drone } from "@/entities/drone/types";

export const DRONE_HINT =
  /drone|uav|ugv|usv|fpv|shahed|geran|lancet|bpla|бла|бпла|дрон|квадрокоптер|ланцет|герань|шахед|мавик|молния|курьер|термит|катран|магура|баба яга|interceptor|loitering|unmanned|jammer|РЭБ|EW\b|c-?uas|counter-?drone|anti-?drone|антидрон|протидрон|перехват|shorad|зрк|зрпк|pantsir|панцир|tunguska|тунгуск|gepard|гепард|volnorez|волнорез|skywiper|edm4s|stupor|ступор|harpoon-?3|гарпун|tsukorok|цукорок|bulat|булат|(?<![\p{L}])(?:tor-?m\d?|тор-?м\d?|osa-?akm|оса-?акм)(?![\p{L}])/iu;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build a regex from every drone's name, cyrillic spelling, and aliases.
 * This grows automatically as the catalog expands — new systems are caught
 * without any code changes. Returns null when the catalog is empty.
 */
export function buildCatalogPattern(drones: Drone[]): RegExp | null {
  const terms = new Set<string>();
  for (const d of drones) {
    if (d.name) terms.add(escapeRegex(d.name));
    if (d.cyrillic) terms.add(escapeRegex(d.cyrillic));
    for (const a of d.aliases) terms.add(escapeRegex(a));
  }
  if (terms.size === 0) return null;
  return new RegExp([...terms].join("|"), "i");
}
