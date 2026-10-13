export interface HeuristicFixture {
  name: string;
  lang: string;
  text: string;
  expectedKeys: string[];
}

/** Small deterministic heuristic-quality gate; one representative paragraph per language. */
export const HEURISTIC_CORPUS: HeuristicFixture[] = [
  {
    name: "en weights, range, endurance, dimensions",
    lang: "en",
    text: "The Geran-2 has an empty weight of 200 kg, MTOW 250 kg, a 50 kg warhead, range 1,000 km, endurance 6 hours, a 2.5 m wingspan and a 3 m length.",
    expectedKeys: [
      "weight_empty",
      "weight_mtow",
      "warhead",
      "range",
      "endurance",
      "wingspan",
      "length",
    ],
  },
  {
    name: "en dimensions and guidance",
    lang: "en",
    text: "The FP-1 is 3.5 m long and 0.8 m wide, carries a 15 kg payload, and uses GPS/INS.",
    expectedKeys: ["length", "width", "payload", "guidance"],
  },
  {
    name: "ru UAV performance",
    lang: "ru",
    text: "Geran-2 имеет дальность 1000 км, скорость 180 км/ч, время полета 6 часов, размах крыла 3 м и полезная нагрузка 15 кг.",
    expectedKeys: ["range", "speed", "endurance", "wingspan", "payload"],
  },
  {
    name: "ru weights and dimensions",
    lang: "ru",
    text: "Максимальная взлетная масса 250 кг, сухая масса 200 кг, диаметр 0,3 м и высота 1 м.",
    expectedKeys: ["weight_mtow", "weight_empty", "diameter", "height"],
  },
  {
    name: "uk UAV performance",
    lang: "uk",
    text: "Geran-2 має дальність 1000 км, швидкість 180 км/год, час польоту 6 годин, розмах крил 3 м і корисне навантаження 15 кг.",
    expectedKeys: ["range", "speed", "endurance", "wingspan", "payload"],
  },
  {
    name: "uk weights and dimensions",
    lang: "uk",
    text: "Максимальна злітна маса 250 кг, пуста маса 200 кг, діаметр 0,3 м і довжина 3 м.",
    expectedKeys: ["weight_mtow", "weight_empty", "diameter", "length"],
  },
  {
    name: "sv UAV performance",
    lang: "sv",
    text: "Geran-2 har räckvidd 1000 km, hastighet 180 km/tim, flygtid 2 timmar, vingbredd 3 m och nyttolast 15 kg.",
    expectedKeys: ["range", "speed", "endurance", "wingspan", "payload"],
  },
  {
    name: "sv weights and dimensions",
    lang: "sv",
    text: "Max startvikt 250 kg, tomvikt 200 kg, diameter 0,3 m och höjd 1 m.",
    expectedKeys: ["weight_mtow", "weight_empty", "diameter", "height"],
  },
];
