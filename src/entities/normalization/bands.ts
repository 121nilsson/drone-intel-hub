export interface FrequencyBandDefinition {
  id: string;
  label: string;
  minMHz: number;
  /** Exclusive upper bound, except the last band in each table, which is inclusive. */
  maxMHz: number;
}

/**
 * IEEE radar-frequency letter bands, IEEE Std 521.
 * K (18–27 GHz) and Ka (27–40 GHz) are separate: lumping them hides satcom.
 */
export const IEEE_BANDS: FrequencyBandDefinition[] = [
  { id: "VHF", label: "IEEE VHF", minMHz: 30, maxMHz: 300 },
  { id: "UHF", label: "IEEE UHF", minMHz: 300, maxMHz: 1_000 },
  { id: "L", label: "IEEE L", minMHz: 1_000, maxMHz: 2_000 },
  { id: "S", label: "IEEE S", minMHz: 2_000, maxMHz: 4_000 },
  { id: "C", label: "IEEE C", minMHz: 4_000, maxMHz: 8_000 },
  { id: "X", label: "IEEE X", minMHz: 8_000, maxMHz: 12_000 },
  { id: "Ku", label: "IEEE Ku", minMHz: 12_000, maxMHz: 18_000 },
  { id: "K", label: "IEEE K", minMHz: 18_000, maxMHz: 27_000 },
  { id: "Ka", label: "IEEE Ka", minMHz: 27_000, maxMHz: 40_000 },
];

/**
 * NATO EW letter bands (the commonly published A–M table).
 * NATO C is 500–1000 MHz; IEEE C is 4–8 GHz. Callers must render the prefixed label.
 * The older variant that shifts G/H/I is not mixed in.
 */
export const NATO_BANDS: FrequencyBandDefinition[] = [
  { id: "A", label: "NATO A", minMHz: 0, maxMHz: 250 },
  { id: "B", label: "NATO B", minMHz: 250, maxMHz: 500 },
  { id: "C", label: "NATO C", minMHz: 500, maxMHz: 1_000 },
  { id: "D", label: "NATO D", minMHz: 1_000, maxMHz: 2_000 },
  { id: "E", label: "NATO E", minMHz: 2_000, maxMHz: 3_000 },
  { id: "F", label: "NATO F", minMHz: 3_000, maxMHz: 4_000 },
  { id: "G", label: "NATO G", minMHz: 4_000, maxMHz: 6_000 },
  { id: "H", label: "NATO H", minMHz: 6_000, maxMHz: 8_000 },
  { id: "I", label: "NATO I", minMHz: 8_000, maxMHz: 10_000 },
  { id: "J", label: "NATO J", minMHz: 10_000, maxMHz: 20_000 },
  { id: "K", label: "NATO K", minMHz: 20_000, maxMHz: 40_000 },
  { id: "L", label: "NATO L", minMHz: 40_000, maxMHz: 60_000 },
  { id: "M", label: "NATO M", minMHz: 60_000, maxMHz: 100_000 },
];

function intersecting(table: FrequencyBandDefinition[], mhz: [number, number]): string[] {
  const lo = Math.min(mhz[0], mhz[1]);
  const hi = Math.max(mhz[0], mhz[1]);
  const last = table[table.length - 1];
  return table
    .filter((b) => {
      const upperInclusive = b === last;
      if (upperInclusive) return lo <= b.maxMHz && hi >= b.minMHz;
      // [lo, hi] against [min, max). A boundary point belongs to the next band.
      return lo < b.maxMHz && hi >= b.minMHz && !(lo === hi && lo === b.maxMHz);
    })
    .map((b) => b.id);
}

/** Every IEEE band the range intersects. A boundary frequency lands in exactly one band. */
export function ieeeBandsFor(mhz: [number, number]): string[] {
  return intersecting(IEEE_BANDS, mhz);
}

/** Every NATO band the range intersects. */
export function natoBandsFor(mhz: [number, number]): string[] {
  return intersecting(NATO_BANDS, mhz);
}

export function ieeeLabel(id: string): string {
  return IEEE_BANDS.find((b) => b.id === id)?.label ?? `IEEE ${id}`;
}

export function natoLabel(id: string): string {
  return NATO_BANDS.find((b) => b.id === id)?.label ?? `NATO ${id}`;
}
