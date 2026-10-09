export interface ExtractionFixture {
  name: string;
  text: string;
  expectedKeys: string[];
  systems?: string[];
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
    text: "The Baba Yaga carries a 15 kg payload and four mortar bombs. Unit price is $15,000-$20,000.",
    systems: ["Baba Yaga"],
    expectedKeys: ["payload", "unit_cost"],
  },
  {
    name: "multi system attribution",
    text: "Geran-5 reached 600 km/h. The STING S interceptor reached 220 km/h and used an EO camera.",
    systems: ["Geran-5", "STING S"],
    expectedKeys: ["speed"],
  },
];
