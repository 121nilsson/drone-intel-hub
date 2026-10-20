import { describe, expect, it } from "vitest";
import { HeuristicExtractor } from "@/shared/infra/heuristic-ai";
import type { Drone } from "@/entities/drone/types";

const drone = (id: string, name: string, over: Partial<Drone> = {}): Drone => ({
  id,
  name,
  aliases: [],
  domain: "Air",
  origin: "??",
  operators: [],
  propulsion: "Unknown",
  summary: "",
  specs: [],
  rf: [],
  components: [],
  evolution: [],
  counterpartIds: [],
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  ...over,
});

/** A spec sheet whose first line names the system being replaced, not the subject. */
const SPEC_SHEET = `General Atomics представила новий автономний БпЛА Wildfire — дешевшу та масову заміну MQ‑9 Reaper

Wildfire — це повністю нова платформа, створена для програми Massed Modular Aircraft (MMA). Дрон має бути в рази дешевшим, автономним, придатним для масового виробництва.

 Характеристики:
• Роль: заміна MQ‑9A Reaper у розвідці, ударах та масованих операціях
• Дальність перельоту: понад 8 000 морських миль
• Бойовий радіус: щонайменше 2 300 морських миль`;

const CATALOG = [
  drone("mq-9a-reaper-fc46", "MQ-9A Reaper", { manufacturer: "General Atomics" }),
  drone("yfq-44a-fury-cca-6a0b", "YFQ-44A Fury CCA", { aliases: ["FQ-42A CCA"] }),
  drone("f35-1", "F-35A"),
  drone("shahed-1", "Shahed-136"),
];

describe("heuristic attribution to a system that is only mentioned", () => {
  it("does not file the subject's measurements under a system named in another line", async () => {
    const out = await new HeuristicExtractor(2).extract(SPEC_SHEET, CATALOG);
    const slices =
      (
        out as unknown as {
          systemExtractions?: { name: string; matchId?: string; specs: unknown[] }[];
        }
      ).systemExtractions ?? [];
    const reaper = slices.find((s) => s.matchId === "mq-9a-reaper-fc46");

    // "MQ-9A Reaper" appears only in the Role line, which carries no measurement. The range
    // belongs to the platform the sheet is about, not to the system being replaced.
    expect(reaper?.specs ?? []).toEqual([]);
  });

  it("still reads a measurement that sits on the same line as the system", async () => {
    const raw = `• MQ-9A Reaper: дальність перельоту понад 3 000 морських миль`;
    const out = await new HeuristicExtractor(2).extract(raw, CATALOG);
    const slices =
      (
        out as unknown as {
          systemExtractions?: { matchId?: string; specs: { value: unknown }[] }[];
        }
      ).systemExtractions ?? [];
    const reaper = slices.find((s) => s.matchId === "mq-9a-reaper-fc46");
    expect(reaper?.specs.length).toBeGreaterThan(0);
  });

  it("keeps a spec sheet's figures in the post's own extraction", async () => {
    // A sheet whose header names the system: the figures belong to it, and the extraction as a
    // whole carries them, so a system that is not in the catalog yet is catalogued with them.
    const raw = `Характеристики ракети 300 ER (UAV-300)
• Довжина: ~5 м
• Маса: ~900 кг
• Дальність: від 250 км до 500+ км`;
    const out = await new HeuristicExtractor(2).extract(raw, CATALOG);
    const keys = out.specs.map((s) => s.semantic ?? s.key);
    expect(keys).toContain("dimension.length");
    expect(keys).toContain("range.max");
  });
});
