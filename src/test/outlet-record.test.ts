import { describe, expect, it } from "vitest";
import {
  MAX_WEIGHT,
  MIN_RECORD,
  MIN_WEIGHT,
  NEUTRAL_WEIGHT,
  evidenceFrom,
  outletKey,
  outletWeights,
} from "@/features/intake/outlet-record";
import { phoneticKey } from "@/entities/drone/name-key";
import type { RawDispatch } from "@/entities/dispatch/types";

const dispatch = (sourceName: string, status: string, outcome?: string): RawDispatch =>
  ({
    id: `${sourceName}-${status}-${outcome ?? "none"}-${Math.random()}`,
    sourceId: sourceName,
    sourceName,
    externalId: "x",
    url: "https://example.com/x",
    text: "text",
    createdAt: "2026-10-11T00:00:00.000Z",
    status,
    outcome,
  }) as RawDispatch;

/** N stored posts from one outlet, `relevant` of which the pipeline kept. */
const record = (sourceName: string, stored: number, relevant: number): RawDispatch[] => {
  const out: RawDispatch[] = [];
  for (let i = 0; i < relevant; i++) out.push(dispatch(sourceName, "processed"));
  for (let i = relevant; i < stored; i++) out.push(dispatch(sourceName, "irrelevant"));
  return out;
};

describe("outletKey: an outlet recognised whatever its feed is called", () => {
  it("keys the outlet, not the feed or the URL", () => {
    expect(outletKey("Militarnyi · https://mil.in.ua/a")).toBe(
      outletKey("Militarnyi (RSS) · https://mil.in.ua/feed"),
    );
    expect(outletKey("Ukrinform (War) · https://ukrinform.net/rss")).toBe(phoneticKey("Ukrinform"));
  });
});

describe("outletWeights: what an outlet's record makes its word worth", () => {
  it("weighs an outlet with too little history neutral", () => {
    const weights = outletWeights(record("Defense Express", MIN_RECORD - 1, 0));
    expect(weights.get(phoneticKey("Defense Express"))).toBe(NEUTRAL_WEIGHT);
  });

  it("weighs a reporting outlet and a repost-only outlet at opposite ends", () => {
    const weights = outletWeights([...record("Militarnyi", 20, 20), ...record("Rybar", 20, 0)]);
    expect(weights.get(phoneticKey("Militarnyi"))).toBe(MAX_WEIGHT);
    // The floor is the point: a noise outlet still counts, but never more than half an outlet.
    expect(weights.get(phoneticKey("Rybar"))).toBe(MIN_WEIGHT);
  });

  it("weighs a partially relevant outlet proportionally", () => {
    const weights = outletWeights(record("TWZ", 10, 3));
    expect(weights.get(phoneticKey("TWZ"))).toBeCloseTo(0.5 + 0.3, 5);
  });
});

describe("evidenceFrom", () => {
  it("counts outlets plainly when no weights are supplied", () => {
    // Yesterday's behaviour: two outlets, evidence two - a caller without the archive.
    expect(evidenceFrom(["a", "b"], undefined)).toBe(2);
    expect(evidenceFrom(["a", "b"], new Map())).toBe(2);
  });

  it("sums the distinct outlets' weights when they are", () => {
    const weights = new Map([
      [phoneticKey("Militarnyi"), MAX_WEIGHT],
      [phoneticKey("Rybar"), MIN_WEIGHT],
    ]);
    // A key the weights know nothing about still weighs neutral, not zero.
    expect(
      evidenceFrom([phoneticKey("Militarnyi"), phoneticKey("Rybar"), "unknown-outlet"], weights),
    ).toBe(MAX_WEIGHT + MIN_WEIGHT + NEUTRAL_WEIGHT);
  });
});
