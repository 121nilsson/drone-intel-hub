import type { SpecAttribute } from "./types";

export interface Consensus {
  display: string;
  min?: number;
  max?: number;
  median?: number;
  sources: number;
  confidence: "high" | "medium" | "low";
}

export function consensus(spec: SpecAttribute): Consensus {
  const nums = spec.claims.map((c) => c.value).filter((v): v is number => typeof v === "number").sort((a, b) => a - b);
  const sources = new Set(spec.claims.map((c) => c.source)).size;
  if (nums.length === 0) {
    const counts = new Map<string, number>();
    spec.claims.forEach((c) => counts.set(String(c.value), (counts.get(String(c.value)) ?? 0) + 1));
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    const agree = top ? top[1] / spec.claims.length : 0;
    return { display: top?.[0] ?? "—", sources, confidence: sources >= 3 && agree > 0.6 ? "high" : sources >= 2 ? "medium" : "low" };
  }
  const min = nums[0]!, max = nums[nums.length - 1]!;
  const median = nums[Math.floor(nums.length / 2)]!;
  const spread = median ? (max - min) / median : 0;
  const confidence = sources >= 3 && spread < 0.25 ? "high" : sources >= 2 && spread < 0.6 ? "medium" : "low";
  const u = spec.unit ? ` ${spec.unit}` : "";
  return { display: min === max ? `${median}${u}` : `${median}${u}`, min, max, median, sources, confidence };
}
