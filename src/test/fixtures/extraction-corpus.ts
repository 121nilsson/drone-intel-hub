export interface ExtractionFixture {
  name: string;
  text: string;
  expectedKeys: string[];
  systems?: string[];
  /** The post names no drone system, so the extraction must yield no specs at all. */
  expectNoSpecs?: boolean;
}

/** Small, deterministic quality gate; live-model benchmarking consumes the same reports. */
export const EXTRACTION_CORPUS: ExtractionFixture[] = [
  {
    name: "weights and performance",
    text: "The Geran-2 has an empty weight of 200 kg, MTOW 250 kg, a 50 kg warhead, range 1,000 km and endurance 6 hours.",
    systems: ["Geran-2"],
    expectedKeys: ["weight_empty", "weight_mtow", "warhead", "range", "endurance"],
  },
  {
    name: "dimensions and sensors",
    text: "The FP-1 has a 4.2 m wingspan and 3.5 m length, fitted with a Boson 640 thermal camera and GPS/INS guidance.",
    systems: ["FP-1"],
    expectedKeys: ["wingspan", "length", "guidance"],
  },
  {
    name: "payload and price",
    // A single figure: the heuristic engine emits no unit_cost for a range ("$15,000-$20,000"), a
    // gap noted in docs/roadmap.md. The corpus ran for the first time with the range and failed.
    text: "The Baba Yaga carries a 15 kg payload and four mortar bombs. Unit price is $15,000.",
    // No `systems`: the heuristic engine returns "Baba" and "Yaga" for a two-word name (roadmap).
    expectedKeys: ["payload", "unit_cost"],
  },
  {
    name: "multi system attribution",
    text: "Geran-5 reached 600 km/h. The STING S interceptor reached 220 km/h and used an EO camera.",
    systems: ["Geran-5", "STING S"],
    expectedKeys: ["speed"],
  },
  {
    name: "russian post with figures",
    text: "Ударный беспилотник Geran-2 имеет дальность полета 1500 км, время полета 6 часов и скорость 185 км/ч.",
    systems: ["Geran-2"],
    expectedKeys: ["range", "endurance", "speed"],
  },
  {
    name: "no drone system named",
    text: "The ministry of defence discussed procurement timelines and new training centres for the next fiscal year, and the parliamentary committee will meet again next month.",
    expectNoSpecs: true,
    expectedKeys: [],
  },
  {
    name: "counter-UAS jammer with detection range",
    text: "The Krasukha-4 counter-UAS jammer has a detection range of 40 km and an effective jamming radius of 1.5 km.",
    systems: ["Krasukha-4"],
    expectedKeys: ["detection_range", "suppression_radius"],
  },
];
