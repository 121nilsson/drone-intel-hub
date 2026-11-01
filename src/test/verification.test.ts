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
  linkSourcePosts,
  needsVerification,
  sourcePostLinker,
} from "@/shared/infra/verification/backfill";
import { verificationReport } from "@/shared/infra/verification/run";
import type { RawDispatch } from "@/entities/dispatch/types";
import type { Candidate } from "@/entities/drone/types";
import type { DroneRepository } from "@/shared/contracts/repository";
import { mergeInto, promote } from "@/shared/infra/ingest/pipeline-actions";

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
    const older: ClaimVerification = {
      state: "verified",
      checks: [
        {
          id: "evidence_span",
          kind: "evidence_span",
          verdict: "pass",
          applicable: true,
          verifierVersion: "deterministic-1",
          at: AT,
        },
      ],
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

  it("re-runs a verdict that never had the post, since it loses nothing", () => {
    const fresh = catalogue();
    const claim = { ...fresh.specs[0]!.claims[0]! };
    delete claim.sourceId;
    const blind = verifyClaim({ drone: fresh, spec: fresh.specs[0]!, claim, at: AT })!;
    const stored: Drone = {
      ...fresh,
      specs: [
        {
          ...fresh.specs[0]!,
          claims: [{ ...claim, verification: { ...blind, verifierVersion: "deterministic-1" } }],
        },
      ],
    };
    const result = backfillDrones([stored], () => undefined, undefined, AT);
    const check = result.drones[0]!.specs[0]!.claims[0]!.verification!.checks[0]!;
    expect(check.detail).toBe("the claim records no source post");
    expect(check.verifierVersion).toBe(VERIFIER_VERSION);
  });

  it("says a reference import has no post, rather than that its post was lost", () => {
    const fresh = catalogue();
    const claim = { ...fresh.specs[0]!.claims[0]!, extractionEngine: "reference" };
    delete claim.sourceId;
    const v = verifyClaim({ drone: fresh, spec: fresh.specs[0]!, claim, at: AT })!;
    expect(v.checks.find((c) => c.kind === "evidence_span")?.detail).toBe(
      "reference import: there is no post to check against",
    );
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

describe("merge verification", () => {
  /**
   * A conflicting write is retried against the stored copy. That copy may carry a claim another
   * session added while this one was in flight; it came from a different post, so it must keep
   * whatever verdict it has rather than be judged against this post's text.
   */
  it("does not re-verify another writer's claim against this post's text", () => {
    const oldClaim = point(2_000, "km", "a", { evidence: "2,000 km" });
    const target = drone("x", "X", [spec("range.max", "km", [oldClaim])]);
    const foreign: SpecClaim = {
      id: "foreign",
      value: 40_000,
      source: "other",
      date: "2026-10-02T00:00:00.000Z",
      evidence: "40 000 km",
    };
    const fresh = drone("x", "X", [spec("range.max", "km", [oldClaim, foreign])]);
    let applied: Drone | undefined;
    const drones = {
      list: () => [target],
      get: () => target,
      upsert: (merged: Drone, replay?: (base: Drone) => Drone) => {
        applied = replay ? replay(fresh) : merged;
      },
      remove: () => {},
      search: () => [target],
    };
    const candidates = {
      list: () => [],
      add: () => {},
      update: () => {},
      remove: () => {},
    };
    const candidate: Candidate = {
      id: "candidate-1",
      raw: "The range is 2,000 km.",
      source: "src",
      createdAt: "2026-10-02T00:00:00.000Z",
      tier: 1,
      status: "pending",
      extraction: {
        name: "X",
        aliases: [],
        operators: [],
        specs: [{ key: "range", label: "Range", value: 2_000, raw: "2,000 km", unit: "km" }],
        rfBands: [],
        confidence: 0.9,
        rationale: "test",
      },
    };

    mergeInto(candidate, "x", { drones, candidates });

    const claims = (applied ?? target).specs.flatMap((s) => s.claims);
    expect(claims.find((c) => c.id === "foreign")?.verification).toBeUndefined();
    expect(
      claims.find((c) => c.value === 2_000 && c.id !== oldClaim.id)?.verification,
    ).toBeTruthy();
  });
});

describe("linking claims to their post", () => {
  const post = (id: string, url: string, text = "X has a range of 2,000 km.") =>
    ({ id, sourceName: "Outlet", url, text }) as unknown as RawDispatch;
  const unlinked = (source: string) =>
    drone("x", "X", [
      spec("range.max", "km", [point(2_000, "km", source, { evidence: "2,000 km" })]),
    ]);

  it("links a claim to the one post its source string names", () => {
    const postFor = sourcePostLinker([post("p1", "https://a/1"), post("p2", "https://a/2")]);
    const linked = linkSourcePosts(unlinked("Outlet · https://a/1"), postFor);
    expect(linked.specs[0]!.claims[0]!.sourceId).toBe("p1");
  });

  it("leaves a claim unlinked when its source names two posts", () => {
    const postFor = sourcePostLinker([post("p1", "https://a/1"), post("p2", "https://a/1")]);
    const entry = unlinked("Outlet · https://a/1");
    expect(linkSourcePosts(entry, postFor)).toBe(entry);
  });

  it("never links to a post whose text was stripped", () => {
    const postFor = sourcePostLinker([post("p1", "https://a/1", "")]);
    const entry = unlinked("Outlet · https://a/1");
    expect(linkSourcePosts(entry, postFor)).toBe(entry);
  });

  it("never replaces a post id a claim already has", () => {
    const postFor = sourcePostLinker([post("p1", "https://a/1")]);
    const claim = point(2_000, "km", "Outlet · https://a/1", { sourceId: "p9" });
    expect(postFor(claim)).toBeUndefined();
  });

  it("verifies a linked claim against the post it was linked to", () => {
    const posts = [post("p1", "https://a/1")];
    const result = backfillDrones(
      [unlinked("Outlet · https://a/1")],
      dispatchTextResolver(posts),
      undefined,
      AT,
      sourcePostLinker(posts),
    );
    const claim = result.drones[0]!.specs[0]!.claims[0]!;
    expect(claim.sourceId).toBe("p1");
    expect(claim.verification?.checks.find((c) => c.kind === "evidence_span")?.verdict).toBe(
      "pass",
    );
    expect(result.missingText).toBe(0);
  });
});

describe("queue items keep their post", () => {
  const queued = (over: Partial<Candidate> = {}): Candidate => ({
    id: "cand-1",
    raw: "X has a range of 2,000 km.",
    source: "Outlet · https://a/1",
    dispatchId: "p1",
    createdAt: AT,
    tier: 1,
    status: "pending",
    extraction: {
      name: "X",
      aliases: [],
      operators: [],
      specs: [{ key: "range", label: "Range", value: 2_000, raw: "2,000 km", unit: "km" }],
      rfBands: [],
      confidence: 0.9,
      rationale: "test",
    },
    ...over,
  });
  const repos = (entries: Drone[]) => {
    const written: Drone[] = [];
    return {
      written,
      drones: {
        list: () => entries,
        get: (id: string) => entries.find((e) => e.id === id),
        upsert: (d: Drone) => {
          written.push(d);
        },
        remove: () => {},
        search: () => entries,
      },
      candidates: { list: () => [], add: () => {}, update: () => {}, remove: () => {} },
    };
  };

  it("stamps the post id on the claims a promoted item writes", () => {
    const r = repos([]);
    const promoted = promote(queued(), r);
    const claims = promoted.specs.flatMap((s) => s.claims);
    expect(claims.length).toBeGreaterThan(0);
    expect(claims.every((c) => c.sourceId === "p1")).toBe(true);
  });

  it("stamps the post id on the claims a merged item writes", () => {
    const r = repos([drone("x", "X", [])]);
    mergeInto(queued(), "x", r);
    const claims = r.written.flatMap((d) => d.specs.flatMap((s) => s.claims));
    expect(claims.length).toBeGreaterThan(0);
    expect(claims.every((c) => c.sourceId === "p1")).toBe(true);
  });

  it("writes no post id for pasted text, which has none", () => {
    const r = repos([drone("x", "X", [])]);
    const pasted = queued({ source: "Analyst paste" });
    delete pasted.dispatchId;
    mergeInto(pasted, "x", r);
    const claims = r.written.flatMap((d) => d.specs.flatMap((s) => s.claims));
    expect(claims.some((c) => c.sourceId)).toBe(false);
  });
});
