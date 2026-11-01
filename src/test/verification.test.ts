import { describe, expect, it } from "vitest";
import {
  evidencePassages,
  independentSourceCount,
  sameVerification,
  verificationCoverage,
  verificationExceptions,
  verifyClaim,
  verifyDrone,
  verifyNewClaims,
  VERIFIER_VERSION,
} from "@/entities/drone/verification";
import type {
  ClaimVerification,
  Drone,
  SpecAttribute,
  SpecClaim,
  VerificationKind,
} from "@/entities/drone/types";
import {
  backfillCatalogue,
  backfillDrones,
  dispatchTextResolver,
  needsVerification,
} from "@/shared/infra/verification/backfill";
import { verificationReport } from "@/shared/infra/verification/run";
import type { RawDispatch } from "@/entities/dispatch/types";
import type { DroneRepository } from "@/shared/contracts/repository";

const AT = "2026-10-20T12:00:00.000Z";

const point = (value: number, unit: string, source: string, over: Partial<SpecClaim> = {}) => ({
  id: crypto.randomUUID(),
  value,
  source,
  date: "2026-10-01T00:00:00.000Z",
  normalized: {
    raw: `${value} ${unit}`,
    canonicalValue: value,
    canonicalUnit: unit,
    confidence: 1,
  },
  ...over,
});

const spec = (
  semantic: string,
  unit: string,
  claims: SpecClaim[],
  key = semantic.replace(".", "_"),
): SpecAttribute => ({
  key,
  label: key,
  unit,
  semantic,
  canonicalUnit: unit,
  discoveredBy: "ai",
  claims,
});

const drone = (
  id: string,
  name: string,
  specs: SpecAttribute[],
  aliases: string[] = [],
): Drone => ({
  id,
  name,
  aliases,
  domain: "Air",
  origin: "RU",
  operators: [],
  propulsion: "Unknown",
  summary: "",
  specs,
  rf: [],
  components: [],
  evolution: [],
  counterpartIds: [],
  createdAt: "",
  updatedAt: "",
});

const verdict = (input: Parameters<typeof verifyClaim>[0]): ClaimVerification => {
  const v = verifyClaim(input);
  if (!v) throw new Error("expected a verdict");
  return v;
};

const check = (v: ClaimVerification, kind: VerificationKind) =>
  v.checks.find((c) => c.kind === kind);

describe("verifyClaim", () => {
  it("locates the quoted evidence in the source post", () => {
    const claim = point(2_000, "km", "Militarnyi", {
      evidence: "a range of 2,000 km",
      sourceId: "p1",
    });
    const s = spec("range.max", "km", [claim]);
    const d = drone("shahed", "Shahed-136", [s]);

    const found = verdict({
      drone: d,
      spec: s,
      claim,
      text: "Reports say Shahed-136 has a range of 2,000 km.",
      at: AT,
    });
    expect(check(found, "evidence_span")).toMatchObject({ verdict: "pass", applicable: true });

    const missing = verdict({ drone: d, spec: s, claim, text: "A different post.", at: AT });
    expect(check(missing, "evidence_span")).toMatchObject({ verdict: "fail" });
    expect(missing.state).toBe("rejected");
  });

  it("is uncertain, not rejecting, when there is no source text to check against", () => {
    const claim = point(500, "km", "Rybar", { evidence: "500 km", sourceId: "gone" });
    const s = spec("range.max", "km", [claim]);
    const v = verdict({ drone: drone("x", "X", [s]), spec: s, claim, at: AT });
    expect(check(v, "evidence_span")).toMatchObject({ verdict: "uncertain", applicable: true });
    expect(v.state).toBe("uncertain");
  });

  it("rejects a value measured in a different dimension from its attribute", () => {
    const claim = point(5, "km", "a");
    const s = spec("endurance", "min", [claim]);
    const v = verdict({ drone: drone("x", "X", [s]), spec: s, claim, text: "5 km", at: AT });
    expect(check(v, "unit_dimension")).toMatchObject({ verdict: "fail" });
    expect(v.state).toBe("rejected");
  });

  it("rejects a figure outside the plausible bounds for its attribute", () => {
    const claim = point(40_000, "km", "a");
    const s = spec("range.max", "km", [claim]);
    const v = verdict({ drone: drone("x", "X", [s]), spec: s, claim, text: "40 000 km", at: AT });
    expect(check(v, "bounds")).toMatchObject({ verdict: "fail" });
    expect(v.state).toBe("rejected");
  });

  it("passes bounds for an ordinary figure", () => {
    const claim = point(2_500, "km", "a");
    const s = spec("range.max", "km", [claim]);
    const v = verdict({ drone: drone("x", "X", [s]), spec: s, claim, text: "2 500 km", at: AT });
    expect(check(v, "bounds")).toMatchObject({ verdict: "pass" });
  });

  it("fails identity when the evidence names another catalog system", () => {
    const claim = point(50, "km", "a", {
      evidence: "The Lancet loitering munition has a 50 km range.",
    });
    const s = spec("range.max", "km", [claim]);
    const held = drone("shahed", "Shahed-136", [s]);
    const other = drone("lancet", "Lancet", []);
    const v = verdict({
      drone: held,
      spec: s,
      claim,
      text: claim.evidence,
      catalog: [held, other],
      at: AT,
    });
    expect(check(v, "identity")).toMatchObject({ verdict: "fail" });
    expect(check(v, "identity")?.detail).toContain("Lancet");
  });

  it("recognises the system through an alias", () => {
    const claim = point(2_000, "km", "a", { evidence: "Geran-2 strikes at 2,000 km." });
    const s = spec("range.max", "km", [claim]);
    const d = drone("shahed", "Shahed-136", [s], ["Geran-2"]);
    const v = verdict({ drone: d, spec: s, claim, text: claim.evidence, catalog: [d], at: AT });
    expect(check(v, "identity")).toMatchObject({ verdict: "pass" });
  });

  it("anchors identity to the evidence sentence, not to the whole post", () => {
    const claim = point(40, "km", "a", { evidence: "a range of 40 km", sourceId: "p1" });
    const s = spec("range.max", "km", [claim]);
    const held = drone("shahed", "Shahed-136", [s]);
    const lancet = drone("lancet", "Lancet-3", []);
    const text = "Shahed-136 strikes continued overnight. Lancet-3 has a range of 40 km.";
    const v = verdict({ drone: held, spec: s, claim, text, catalog: [held, lancet], at: AT });
    // The post names Shahed-136, but the sentence carrying the figure is about Lancet-3.
    expect(check(v, "identity")).toMatchObject({ verdict: "fail" });
    expect(v.state).toBe("rejected");
  });

  it("is uncertain, never a pass, when the evidence sentence names no system", () => {
    const claim = point(2_000, "km", "a", { evidence: "2,000 km", sourceId: "p1" });
    const s = spec("range.max", "km", [claim]);
    const d = drone("shahed", "Shahed-136", [s]);
    const text = "Shahed-136 launches rose again. The range is about 2,000 km.";
    const v = verdict({ drone: d, spec: s, claim, text, catalog: [d], at: AT });
    expect(check(v, "identity")).toMatchObject({ verdict: "uncertain", applicable: true });
    expect(check(v, "identity")?.detail).toContain("the post names this one");
    expect(v.state).toBe("uncertain");
  });

  it("finds a quote that crosses a sentence boundary in an adjacent pair", () => {
    expect(
      evidencePassages("Shahed-136 flies approx. 2,000 km. Other news.", "approx. 2,000 km"),
    ).toEqual(["shahed-136 flies approx. 2,000 km."]);
    expect(evidencePassages("Nothing here.", "2,000 km")).toEqual([]);
  });

  it("is uncertain when the evidence sentence names this system and another", () => {
    const claim = point(40, "km", "a", { evidence: "a range of 40 km" });
    const s = spec("range.max", "km", [claim]);
    const held = drone("shahed", "Shahed-136", [s]);
    const lancet = drone("lancet", "Lancet-3", []);
    const text = "Unlike the Shahed-136, the Lancet-3 has a range of 40 km.";
    const v = verdict({ drone: held, spec: s, claim, text, catalog: [held, lancet], at: AT });
    expect(check(v, "identity")).toMatchObject({ verdict: "uncertain", applicable: true });
    expect(v.state).toBe("uncertain");
  });

  it("does not cut a sentence at an abbreviation", () => {
    const claim = point(2_000, "km", "a", { evidence: "2,000 km" });
    const s = spec("range.max", "km", [claim]);
    const d = drone("shahed", "Shahed-136", [s]);
    const text = "Shahed-136 has a range of approx. 2,000 km.";
    const v = verdict({ drone: d, spec: s, claim, text, catalog: [d], at: AT });
    expect(check(v, "identity")).toMatchObject({ verdict: "pass" });
  });

  it("finds a quote laid out over several lines", () => {
    expect(evidencePassages("Shahed-136\nRange:\n2,000 km", "Shahed-136 Range: 2,000 km")).toEqual([
      "shahed-136 range: 2,000 km",
    ]);
  });

  it("does not take a stopword alias as the system's name", () => {
    const claim = point(40, "km", "a", { evidence: "Air defence reported 40 km" });
    const s = spec("range.max", "km", [claim]);
    const d = drone("x", "Shahed-136", [s], ["Air"]);
    const text = "Air defence reported 40 km.";
    const v = verdict({ drone: d, spec: s, claim, text, catalog: [d], at: AT });
    expect(check(v, "identity")?.verdict).not.toBe("pass");
  });

  it("keeps variant numbers strict: Geran-5 does not vouch for Geran-2", () => {
    const claim = point(1_000, "km", "a", { evidence: "Geran-5 reaches 1,000 km" });
    const s = spec("range.max", "km", [claim]);
    const g2 = drone("g2", "Geran-2", [s]);
    const g5 = drone("g5", "Geran-5", []);
    const text = "Geran-5 reaches 1,000 km.";
    const v = verdict({ drone: g2, spec: s, claim, text, catalog: [g2, g5], at: AT });
    expect(check(v, "identity")).toMatchObject({ verdict: "fail" });
  });

  it("recognises the system in another script", () => {
    const claim = point(40, "km", "a", { evidence: "Ланцет-3 летит на 40 км" });
    const s = spec("range.max", "km", [claim]);
    const d = drone("lancet", "Lancet-3", [s]);
    const text = "Ланцет-3 летит на 40 км.";
    const v = verdict({ drone: d, spec: s, claim, text, catalog: [d], at: AT });
    expect(check(v, "identity")).toMatchObject({ verdict: "pass" });
  });

  it("counts two feeds of one outlet as one source", () => {
    const s = spec("range.max", "km", [
      point(2_000, "km", "Ukrinform (War) · https://ukrinform.ua/a"),
      point(2_000, "km", "Ukrinform (Economy) · https://ukrinform.ua/b"),
      point(2_000, "km", "Militarnyi · https://mil.in.ua/c"),
    ]);
    expect(independentSourceCount(s, s.claims[0]!)).toBe(2);
  });

  it("leaves an analyst claim without a machine verdict", () => {
    const claim = point(999, "km", "Analyst", { extractionEngine: "analyst" });
    const s = spec("range.max", "km", [claim]);
    expect(verifyClaim({ drone: drone("x", "X", [s]), spec: s, claim, at: AT })).toBeUndefined();
  });

  it("counts distinct outlets stating the same figure", () => {
    const s = spec("range.max", "km", [
      point(2_000, "km", "a"),
      point(2_050, "km", "b"),
      point(900, "km", "c"),
    ]);
    expect(independentSourceCount(s, s.claims[0]!)).toBe(2);
  });
});

describe("verifyDrone", () => {
  const verified = () => {
    const claim = point(2_000, "km", "a", { evidence: "2,000 km" });
    const s = spec("range.max", "km", [claim]);
    return drone("x", "X", [s]);
  };

  it("is idempotent: a second pass changes nothing", () => {
    const once = verifyDrone(verified(), () => undefined, [], AT);
    const twice = verifyDrone(once, () => undefined, [], AT);
    expect(twice).toBe(once);
  });

  it("returns the same object when a claim already carries an equal verdict", () => {
    const v1 = verdict({
      drone: verified(),
      spec: verified().specs[0]!,
      claim: verified().specs[0]!.claims[0]!,
      at: AT,
    });
    expect(sameVerification(v1, { ...v1, at: "later" })).toBe(true);
  });

  it("verifies only the claims a post just added", () => {
    const old = point(2_000, "km", "a", { evidence: "old wording" });
    const s = spec("range.max", "km", [old]);
    const known = new Set([old.id!]);
    const before = verifyDrone(drone("x", "X", [s]), () => undefined, [], AT);
    const withNew: Drone = {
      ...before,
      specs: [{ ...before.specs[0]!, claims: [...before.specs[0]!.claims, point(500, "km", "b")] }],
    };
    const after = verifyNewClaims(withNew, known, "This post says 500 km.", [], AT);
    // The old claim keeps the verdict it had, not one judged on the new post's text.
    expect(after.specs[0]!.claims[0]!.verification).toBe(before.specs[0]!.claims[0]!.verification);
    expect(after.specs[0]!.claims[1]!.verification?.verifierVersion).toBe(VERIFIER_VERSION);
  });
});

describe("backfill", () => {
  const catalogue = () => {
    const claim = point(2_000, "km", "a", { sourceId: "p1", evidence: "2,000 km" });
    return drone("x", "X", [spec("range.max", "km", [claim])]);
  };

  it("resolves a claim's text from its own source id", () => {
    const dispatches = [{ id: "p1", text: "the range is 2,000 km" }] as unknown as RawDispatch[];
    expect(dispatchTextResolver(dispatches)(catalogue().specs[0]!.claims[0]!)).toBe(
      "the range is 2,000 km",
    );
  });

  it("only looks at claims never checked or checked by an older verifier", () => {
    expect(needsVerification(catalogue().specs[0]!.claims[0]!)).toBe(true);
    const checked = verifyDrone(catalogue(), () => "2,000 km", [], AT);
    expect(needsVerification(checked.specs[0]!.claims[0]!)).toBe(false);
  });

  it("is idempotent and rewrites nothing once verified", () => {
    const first = backfillDrones([catalogue()], () => "2,000 km", undefined, AT);
    expect(first.changed).toHaveLength(1);
    const second = backfillDrones(first.drones, () => "2,000 km", undefined, AT);
    expect(second.changed).toHaveLength(0);
    expect(second.checked).toBe(0);
  });

  it("keeps an older verdict rather than re-judge a claim whose post has left the archive", () => {
    const fresh = catalogue();
    const claim = fresh.specs[0]!.claims[0]!;
    const older = {
      state: "verified" as const,
      checks: [],
      confidence: 1,
      coverage: 1,
      independentSources: 1,
      verifierVersion: "deterministic-1",
      at: AT,
    };
    const stored: Drone = {
      ...fresh,
      specs: [{ ...fresh.specs[0]!, claims: [{ ...claim, verification: older }] }],
    };
    const result = backfillDrones([stored], () => undefined, undefined, AT);
    expect(result.changed).toHaveLength(0);
    expect(result.missingText).toBe(1);
    expect(result.drones[0]!.specs[0]!.claims[0]!.verification).toBe(older);
  });

  it("reports claims whose source post is not in the archive", () => {
    const result = backfillDrones([catalogue()], () => undefined, undefined, AT);
    expect(result.missingText).toBe(1);
  });

  it("writes only the entries that changed, through the repository", async () => {
    const ds = [catalogue()];
    const wrote: string[] = [];
    const drones = {
      list: () => ds,
      upsert: (d: Drone) => {
        wrote.push(d.id);
      },
    } as unknown as DroneRepository;
    const dispatches = {
      list: () => [{ id: "p1", text: "2,000 km" }] as unknown as RawDispatch[],
    };
    await backfillCatalogue({ drones, dispatches });
    expect(wrote).toEqual(["x"]);
  });

  it("verifies the live copy of an entry edited while the run yielded", async () => {
    const entries = Array.from({ length: 25 }, (_, i) => ({ ...catalogue(), id: `d${i}` }));
    let current: Drone[] = entries;
    const written = new Map<string, Drone>();
    const drones = {
      list: () => current,
      upsert: (d: Drone) => {
        written.set(d.id, d);
      },
    } as unknown as DroneRepository;
    const dispatches = { list: () => [] as RawDispatch[] };
    const run = backfillCatalogue({ drones, dispatches });
    // The first chunk is synchronous; an analyst edits an entry of the second before it runs.
    current = current.map((d) => (d.id === "d24" ? { ...d, summary: "analyst edit" } : d));
    await run;
    expect(written.get("d24")?.summary).toBe("analyst edit");
  });
});

describe("coverage and report", () => {
  const mixed = () => {
    const good = point(2_000, "km", "a", { evidence: "2,000 km" });
    const bad = point(40_000, "km", "b", { evidence: "40 000 km" });
    const hand = point(1, "km", "Analyst", { extractionEngine: "analyst" });
    const s = spec("range.max", "km", [good, bad, hand]);
    return verifyDrone(
      drone("x", "Shahed-136", [s]),
      () => "Shahed-136 has a range of 2,000 km. One outlet put Shahed-136 at 40 000 km.",
      [],
      AT,
    );
  };

  it("counts analyst claims apart from machine-checked ones", () => {
    const c = verificationCoverage([mixed()]);
    expect(c).toMatchObject({ total: 3, analyst: 1, checked: 2, verified: 1, rejected: 1 });
  });

  it("lists rejected claims before uncertain ones and never the verified", () => {
    const rows = verificationExceptions([mixed()]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.verification.state).toBe("rejected");
  });

  it("reports decided over checked, not over the whole catalogue", () => {
    const report = verificationReport([mixed()], {
      at: AT,
      checked: 2,
      changed: 1,
      missingText: 0,
    });
    expect(report.decided).toBe(1);
    expect(report.coverage.checked).toBe(2);
    expect(report.coverage.analyst).toBe(1);
    expect(report.medianIndependentSources).toBe(1);
  });
});
