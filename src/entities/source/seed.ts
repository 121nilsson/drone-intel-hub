import type { Domain } from "@/entities/drone/types";
import type { MonitoredSource } from "./types";

export const SEED_SOURCES: MonitoredSource[] = [
  { id: "bayraktar-1love", name: "Bayraktar 1love", platform: "X", handle: "@bayraktar_1love", domain: "Air", notes: "UA strike/interceptor footage, frequent new-system sightings." },
  { id: "wildhornets", name: "Wild Hornets", platform: "Telegram", handle: "@wildhornets", domain: "Air", notes: "Maker of STING interceptor and Queen of Hornets bombers." },
  { id: "militarnyi", name: "Militarnyi", platform: "Web", handle: "https://mil.in.ua/en/", domain: "Multi", notes: "Ukrainian defence news, procurement and pricing." },
  { id: "defense-express", name: "Defense Express", platform: "Web", handle: "https://en.defence-ua.com/", domain: "Multi", notes: "Technical analysis of captured systems." },
  { id: "rybar", name: "Rybar", platform: "Telegram", handle: "@rybar", domain: "Multi", notes: "RU milblogger — treat claims as low reliability." },
  { id: "war-zone", name: "The War Zone", platform: "RSS", handle: "https://www.twz.com/feed", domain: "Multi", notes: "Long-form drone and USV coverage." },
  { id: "dronebomber", name: "Two Majors", platform: "Telegram", handle: "@dva_majors", domain: "Land", notes: "RU UGV and FPV unit chatter." },
];

const SAMPLES: Record<Domain, string[]> = {
  Air: [
    `Russia has started launching "Geran-5" jet-powered drones; one was intercepted near Kharkiv by a STING S interceptor. Cruise 600 km/h, range 1000 km, 90 kg warhead. Estimated unit cost $15,000-$20,000.`,
    `Baba Yaga heavy bomber hexacopter spotted with 4 cameras and a 15 kg payload, operating on 900 MHz. Price reportedly around $2,000 per airframe.`,
    `New Molniya-1 fixed-wing FPV observed on 5.8 GHz video link, range 40 km, 5 kg payload. Unit cost ₽1.5M per kit.`,
  ],
  Land: [
    `Ukrainian Termit UGV deployed with 2 antennas and a 300 kg payload; logistics runs of 20 km. Procurement at €50k per unit.`,
    `Russian Kur'er UGV seen with mounted AGS and 1 jammers, operating 868 MHz. Cost estimate $30,000.`,
  ],
  Sea: [
    `Magura V7 USV launched AIM-9 missiles at a helicopter; 2 missiles carried, range 1000 km, cruise 90 km/h. Approx $250,000 per boat.`,
    `Katran-X maritime drone sighted with 3 cameras off Crimea, 433 MHz control link.`,
  ],
  Multi: [
    `Bars jet drone-missile struck a refinery; cruise 400 km/h, range 800 km, 20 kg warhead. Unit cost estimated $200k. Lancet-3 also active nearby.`,
    `Shahed-238 variant intercepted by STING S drones; operating on 1575 MHz with CRPA antenna, cruise 500 km/h.`,
  ],
};

export function sampleDispatch(domain: Domain) {
  const pool = [...SAMPLES[domain], ...(domain === "Multi" ? [] : SAMPLES.Multi)];
  return pool[Math.floor(Math.random() * pool.length)]!;
}
