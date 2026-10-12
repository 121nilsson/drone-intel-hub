import { describe, expect, it } from "vitest";
import { DRONE_HINT } from "@/features/sources/auto-ingest";
import { semanticKeyFor } from "@/entities/normalization/semantic";
import { normalizeQuantity } from "@/entities/normalization/units";
import { resolveTerm, SEEDED_TERMS } from "@/entities/normalization/taxonomy";
import { ewMatrix, kineticEnvelope } from "@/entities/normalization/ew-matrix";
import { SEED_DRONES } from "@/entities/drone/seed";

const get = (id: string) => SEED_DRONES.find((d) => d.id === id)!;

describe("counter-drone ingestion and normalization", () => {
  it("keeps air-defence and jammer reports", () => {
    for (const t of ["Расчёт ЗРК Тор-М2 сбил цель", "Volnorez dome on a T-90", "EDM4S delivered"])
      expect(DRONE_HINT.test(t)).toBe(true);
    expect(DRONE_HINT.test("Torino won the match")).toBe(false);
  });
  it("maps envelope specs and watts", () => {
    expect(semanticKeyFor("engagement_range", "Engagement range")).toBe("range.engagement");
    expect(semanticKeyFor("target_speed_max", "Target speed")).toBe("speed.target_max");
    expect(semanticKeyFor("jamming_power", "Jamming power")).toBe("power.rf");
    expect(normalizeQuantity("1.5 kW")?.canonicalValue).toBe(1500);
    expect(normalizeQuantity("50 Вт")?.canonicalUnit).toBe("W");
  });
  it("resolves C-UAS installations", () => {
    expect(resolveTerm("Tracked SAM", "installation", SEEDED_TERMS).canonicalId).toBe("tracked-sam");
    expect(resolveTerm("anti-drone gun", "installation", SEEDED_TERMS).canonicalId).toBe("handheld-gun");
  });
  it("Tor-M2 can engage a Geran-2", () => {
    const rows = kineticEnvelope(get("geran-2"), get("tor-m2"));
    expect(rows.find((r) => r.check === "Speed")?.verdict).toBe("in_envelope");
  });
  it("handheld jammer flags FPV links", () => {
    const fpv = SEED_DRONES.find((d) => d.rf.some((r) => r.freqMHz && r.freqMHz[0] >= 5700));
    if (!fpv) return;
    expect(ewMatrix(fpv, get("edm4s-skywiper")).emitters.length).toBeGreaterThan(0);
  });
});
