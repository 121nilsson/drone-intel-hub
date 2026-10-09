import type { Domain } from "@/entities/drone/types";
import type { MonitoredSource } from "./types";

export const SEED_SOURCES: MonitoredSource[] = [
  // --- Seeded / Core Sources ---
  { id: "bayraktar-1love", name: "Bayraktar 1love", platform: "X", handle: "@bayraktar_1love", domain: "Air", notes: "UA strike/interceptor footage, frequent new-system sightings." },
  { id: "wildhornets", name: "Wild Hornets", platform: "Telegram", handle: "@wildhornets", domain: "Air", notes: "Maker of STING interceptor and Queen of Hornets bombers.", autoSync: true },
  { id: "militarnyi", name: "Militarnyi", platform: "Web", handle: "https://mil.in.ua/en/", domain: "Multi", notes: "Ukrainian defence news, procurement and pricing." },
  { id: "defense-express", name: "Defense Express", platform: "Web", handle: "https://en.defence-ua.com/", domain: "Multi", notes: "Technical analysis of captured systems." },
  { id: "rybar", name: "Rybar", platform: "Telegram", handle: "@rybar", domain: "Multi", notes: "RU milblogger — treat claims as low reliability." },
  { id: "war-zone", name: "The War Zone", platform: "RSS", handle: "https://www.twz.com/feed", domain: "Multi", notes: "Long-form drone and USV coverage.", autoSync: true },
  { id: "dronebomber", name: "Two Majors", platform: "Telegram", handle: "@dva_majors", domain: "Land", notes: "RU UGV and FPV unit chatter." },

  // --- Telegram Channels (High Signal OSINT / Technical) ---
  { id: "serhii-flash", name: "Serhii Flash", platform: "Telegram", handle: "@serhii_flash", domain: "Multi", notes: "Serhii Beskrestnov (call sign 'Flash'), EW advisor to Ukrainian MoD. Deep technical analysis of RF systems, drone frequencies, jammer specs, captured hardware.", autoSync: true },
  { id: "citeam", name: "Conflict Intelligence Team", platform: "Telegram", handle: "@citeam", domain: "Multi", notes: "Independent OSINT investigators. Geolocation of units, equipment identification, supply chain tracking. Claims verified with imagery evidence.", autoSync: true },
  { id: "molfar-global", name: "Molfar OSINT", platform: "Telegram", handle: "@molfar_global", domain: "Multi", notes: "Ukrainian professional OSINT agency. Investigations into Russian drone launch infrastructure, component supply chains, sanctions violations.", autoSync: true },
  { id: "frontelligence", name: "Frontelligence Insight", platform: "Telegram", handle: "@frontelligence", domain: "Multi", notes: "English-language OSINT analysis. Tracks drone innovations, EW tactics, and frontline technology deployments.", autoSync: true },
  { id: "astra-ukraine", name: "ASTRA", platform: "Telegram", handle: "@astra_ukr", domain: "Multi", notes: "Investigative journalism collective. Documents Russian military logistics and supply chain exposés (foreign components in Shahed, etc.)." },
  { id: "war-translated", name: "War Translated", platform: "Telegram", handle: "@wartranslated", domain: "Multi", notes: "Translates and summarises key Russian and Ukrainian milblog posts into English." },
  { id: "rezident-ua", name: "Rezident UA", platform: "Telegram", handle: "@rezident_ua", domain: "Multi", notes: "Ukrainian intelligence-adjacent channel. Early leaks on new drone variants; cross-check unconfirmed claims." },
  { id: "ukraine-weapons", name: "Ukraine Weapons Tracker", platform: "Telegram", handle: "@ukraine_weapons", domain: "Multi", notes: "Documents and identifies captured/destroyed equipment with imagery. Good for component and hardware identification." },

  // --- Telegram Channels (Russian Milbloggers - Low Reliability) ---
  { id: "fighter-bomber", name: "Fighterbomber", platform: "Telegram", handle: "@fighter_bomber", domain: "Air", notes: "Russian VKS pilot blogger. Early reports on UAV/drone air encounters; treat claims as low reliability / unverified.", autoSync: false },
  { id: "intelslava", name: "Intel Slava Z", platform: "Telegram", handle: "@intelslava", domain: "Multi", notes: "Pro-Russian aggregator. High noise volume; useful for early naming signals, claims unverified.", autoSync: false },
  { id: "grey-zone", name: "Grey Zone", platform: "Telegram", handle: "@grey_zone", domain: "Multi", notes: "Russian milblog. Early reports on new munitions and drone variants. Cross-check specs." },
  { id: "wargonzo", name: "Wargonzo", platform: "Telegram", handle: "@wargonzo", domain: "Multi", notes: "Russian war correspondent channel. Front-line footage and early sightings of new UGV/FPV types." },

  // --- Telegram Channels (International OSINT) ---
  { id: "militaryland", name: "MilitaryLand.net", platform: "Telegram", handle: "@militaryland", domain: "Multi", notes: "Maps and front-line documentation. Geotagged imagery of new drone/UGV deployments." },
  { id: "defense-blog-tg", name: "Defence Blog (TG)", platform: "Telegram", handle: "@defence_blog", domain: "Multi", notes: "International defence news aggregator. Global UAV developments and new platform announcements." },
  { id: "osint-ua", name: "OSINT Ukraine", platform: "Telegram", handle: "@osintua", domain: "Multi", notes: "Community OSINT hub. Aggregates and verifies footage from multiple front-line sources." },

  // --- RSS Feeds (Verified Direct URLs) ---
  { id: "breaking-defense", name: "Breaking Defense", platform: "RSS", handle: "https://breakingdefense.com/feed", domain: "Multi", notes: "US & Western defense trade press. Long-form coverage of drone programs, procurement, DARPA projects.", autoSync: true },
  { id: "defense-news-rss", name: "Defense News", platform: "RSS", handle: "https://www.defensenews.com/arc/outboundfeeds/rss/", domain: "Multi", notes: "Global defense trade publication. Strong on procurement, contracts, and new platform introductions.", autoSync: true },
  { id: "defense-one", name: "Defense One", platform: "RSS", handle: "https://www.defenseone.com/rss/all/", domain: "Multi", notes: "Policy and technology focus. US DoD drone strategy and counterdrone procurement.", autoSync: true },
  { id: "rusi-rss", name: "RUSI", platform: "RSS", handle: "https://www.rusi.org/rss/whats-new.xml", domain: "Multi", notes: "Royal United Services Institute. Authoritative analytical papers on drone warfare, EW, and supply chains.", autoSync: true },
  { id: "bellingcat", name: "Bellingcat", platform: "RSS", handle: "https://www.bellingcat.com/feed/", domain: "Multi", notes: "Gold standard OSINT verification. Investigations into drone component origins, supply chain tracking, and sanctions evasion.", autoSync: true },
  // The /news/ category feed was removed: it is a strict subset of the site-wide feed above
  // (measured 2026-10-09: 9 of its 10 items also appear in /feed/, same guid and same link), so
  // every article it carried was already collected. Collection now dedupes on canonical URL as well
  // as on text, which would have caught the overlap anyway - but polling one site twice costs a
  // request and a parse for nothing. Existing installs keep the old row; see RETIRED_SOURCE_IDS.
  { id: "ukrinform-war", name: "Ukrinform (War)", platform: "RSS", handle: "https://www.ukrinform.net/rss/rubric-war", domain: "Multi", notes: "Official Ukrainian state news agency war section. MoD announcements, strike reports, new system deployments." },
  { id: "defence-blog-rss", name: "Defence Blog (RSS)", platform: "RSS", handle: "https://defence-blog.com/feed/", domain: "Multi", notes: "International defence news. Global UAV developments, new platform announcements, captured hardware analysis.", autoSync: true },
  { id: "militarnyi-rss", name: "Militarnyi (UA RSS)", platform: "RSS", handle: "https://mil.in.ua/uk/news/feed/", domain: "Multi", notes: "Ukrainian-language news feed from Militarnyi. High-frequency technical articles." },
  { id: "ukrinform-main", name: "Ukrinform (All)", platform: "RSS", handle: "https://www.ukrinform.net/rss", domain: "Multi", notes: "Broader Ukrinform feed. Filter aggressively with DRONE_HINT — high noise-to-signal ratio.", autoSync: false },

  // --- Web Sources (Scrapable Articles) ---
  { id: "kyiv-independent-war", name: "Kyiv Independent (War)", platform: "Web", handle: "https://kyivindependent.com/tag/war/", domain: "Multi", notes: "Independent Ukrainian journalism. Regular coverage of new drone deployments, EW developments, and Ukrainian industry." },
  { id: "isw-updates", name: "ISW Daily Updates", platform: "Web", handle: "https://understandingwar.org/backgrounder/ukraine-conflict-updates", domain: "Multi", notes: "Institute for the Study of War. Daily campaign assessments with equipment and tactical analysis." },
  { id: "oryxspioenkop", name: "Oryx Equipment Losses", platform: "Web", handle: "https://www.oryxspioenkop.com/2022/02/attack-on-europe-documenting-equipment.html", domain: "Multi", notes: "Visual evidence-based equipment loss tracking. Reference for drone types and hardware identification." },
  { id: "army-recognition", name: "Army Recognition", platform: "Web", handle: "https://www.armyrecognition.com/", domain: "Multi", notes: "International defence news. Global UAV program announcements and defense expo coverage." },
  { id: "ua-mod-press", name: "Ukraine MoD Press", platform: "Web", handle: "https://www.mil.gov.ua/en/news/", domain: "Multi", notes: "Official Ukrainian Ministry of Defence press releases. Confirmed deployments and official disclosures." },
  { id: "drone-below", name: "Drone Below", platform: "Web", handle: "https://dronebelow.com/", domain: "Air", notes: "Commercial and military drone news. Tracking civilian drone platforms militarised in combat.", autoSync: false },

  // --- Drone Manufacturers & DefenseTech (Ukrainian) ---
  { id: "brave1-tg", name: "Brave1 Cluster (TG)", platform: "Telegram", handle: "@Brave1ua", domain: "Multi", notes: "Official Ukrainian DefenseTech platform & marketplace. Tested UAV/UGV/USV/EW announcements.", autoSync: true },
  { id: "brave1-web", name: "Brave1 DefenseTech Hub", platform: "Web", handle: "https://brave1.gov.ua/en/", domain: "Multi", notes: "Official Brave1 portal. Certified military robotics specifications and defense grants." },
  { id: "ukrspecsystems", name: "Ukrspecsystems", platform: "Web", handle: "https://ukrspecsystems.com/news", domain: "Air", notes: "Tactical UAV manufacturer. Maker of SHARK, SHARK-M, PD-2, and Gekata airborne SIGINT." },
  { id: "skyeton", name: "Skyeton", platform: "Web", handle: "https://skyeton.com/news", domain: "Air", notes: "Maker of Raybird-3 (ACS-3) long-endurance tactical reconnaissance UAV system." },
  { id: "deviro", name: "DeViRo", platform: "Web", handle: "https://deviro.ua/", domain: "Air", notes: "Maker of Leleka-100 reconnaissance drone and Leleka-LR long-range systems." },
  { id: "airlogix", name: "Airlogix", platform: "Web", handle: "https://airlogix.io/", domain: "Air", notes: "Maker of Gor tactical reconnaissance drone designed for EW-contested environments." },
  { id: "athlon-avia", name: "Athlon Avia", platform: "Web", handle: "https://athlon.avia.ua/", domain: "Air", notes: "Maker of A1-CM Furia artillery reconnaissance and fire correction UAV." },

  // --- Western & Allied Drone Manufacturers ---
  { id: "aerovironment", name: "AeroVironment", platform: "Web", handle: "https://www.avinc.com/news/", domain: "Air", notes: "Maker of Switchblade 300/600 loitering munitions, Puma 3 AE, Raven, and LOCUST C-UAS." },
  { id: "anduril", name: "Anduril Industries", platform: "Web", handle: "https://www.anduril.com/newsroom/", domain: "Multi", notes: "Maker of Ghost-X, Altius-600/700, Roadrunner jet interceptor, Dive-LD AUV, and Lattice OS." },
  { id: "quantum-systems", name: "Quantum-Systems", platform: "Web", handle: "https://quantum-systems.com/news/", domain: "Air", notes: "German eVTOL maker. Manufacturer of Vector, Scorpion, and AI interceptor drones." },
  { id: "wb-group", name: "WB Group", platform: "Web", handle: "https://www.wbgroup.pl/en/news/", domain: "Air", notes: "Polish defense manufacturer. Maker of Warmate loitering munition and FlyEye UAV." },
  { id: "baykar", name: "Baykar Tech", platform: "Web", handle: "https://baykartech.com/en/press/", domain: "Air", notes: "Turkish unmanned aerospace manufacturer. Maker of Bayraktar TB2, TB3, Akinci, and Kizilelma." },
  { id: "stm-turkey", name: "STM Savunma", platform: "Web", handle: "https://www.stm.com.tr/en/press-releases", domain: "Multi", notes: "Maker of Kargu rotary loitering munition, Boyga mortar UAV, and Togan scout drone." },
  { id: "skydio", name: "Skydio", platform: "Web", handle: "https://www.skydio.com/newsroom", domain: "Air", notes: "Autonomous scouting drones (Skydio X2D / X10D)." },
  { id: "shield-ai", name: "Shield AI", platform: "Web", handle: "https://shield.ai/news", domain: "Air", notes: "Maker of V-BAT long-endurance VTOL drone and Hivemind autonomous pilot." },
  { id: "helsing", name: "Helsing AI", platform: "Web", handle: "https://helsing.ai/news", domain: "Multi", notes: "European defense AI firm. AI sensor processing and autonomous drone strike software." },
  { id: "kratos", name: "Kratos Defense", platform: "Web", handle: "https://ir.kratosdefense.com/press-releases", domain: "Air", notes: "High-performance unmanned systems developer (XQ-58A Valkyrie and jet target drones)." },
  { id: "defsecintel", name: "DefSecIntel", platform: "Web", handle: "https://defsecintel.com/", domain: "Multi", notes: "Estonian defense AI & surveillance maker. SmartWatcher AI towers and drone surveillance." },

  // --- Counter-UAS, EW & Sensor Systems ---
  { id: "droneshield", name: "DroneShield", platform: "Web", handle: "https://www.droneshield.com/media-insights", domain: "Multi", notes: "C-UAS manufacturer. Maker of DroneGun, DroneSentinel, and RfPatrol RF sensors." },
  { id: "dedrone", name: "Dedrone", platform: "Web", handle: "https://www.dedrone.com/newsroom", domain: "Multi", notes: "Airspace security & C-UAS RF signal classification, radar tracking, and mitigation." },
  { id: "epirus", name: "Epirus", platform: "Web", handle: "https://www.epirusinc.com/news", domain: "Air", notes: "Maker of Leonidas high-power microwave (HPM) counter-drone swarm neutralization." },

  // --- Open-Source Flight Firmware & Radio Links (Atom Feeds) ---
  { id: "ardupilot-releases", name: "ArduPilot Releases", platform: "RSS", handle: "https://github.com/ArduPilot/ardupilot/releases.atom", domain: "Multi", notes: "Core autonomous flight navigation software (fixed-wing, VTOL, ground, naval).", autoSync: true },
  { id: "betaflight-releases", name: "Betaflight FPV Firmware", platform: "RSS", handle: "https://github.com/betaflight/betaflight/releases.atom", domain: "Air", notes: "Primary flight controller firmware for tactical FPV strike quadcopters." },
  { id: "expresslrs-releases", name: "ExpressLRS Radio Link", platform: "RSS", handle: "https://github.com/ExpressLRS/ExpressLRS/releases.atom", domain: "Multi", notes: "High-performance open-source radio control link (868/915 MHz, 2.4 GHz anti-jamming).", autoSync: true },
  { id: "openipc-releases", name: "OpenIPC Video Firmware", platform: "RSS", handle: "https://github.com/OpenIPC/firmware/releases.atom", domain: "Air", notes: "Open source IP camera firmware widely used in low-latency digital FPV video links." },
  { id: "inav-releases", name: "INAV Navigation Firmware", platform: "RSS", handle: "https://github.com/iNavFlight/inav/releases.atom", domain: "Air", notes: "Autonomous waypoint navigation and return-to-home software for fixed-wing UAVs." },

  // --- Defense Procurement & Arms Sales Feeds ---
  { id: "dsca-arms-sales", name: "US DSCA Major Arms Sales", platform: "RSS", handle: "https://www.dsca.mil/press-media/major-arms-sales/feed", domain: "Multi", notes: "Official US DSCA Foreign Military Sales (FMS) notifications including UAV systems.", autoSync: true },

  // --- X / Twitter Sources ---
  { id: "osint-technical", name: "OSINT Technical", platform: "X", handle: "@OSINTtechnical", domain: "Multi", notes: "Hardware identification from imagery; frequent drone component analysis." },
  { id: "rebel44cz", name: "Jakub Janovsky (Oryx)", platform: "X", handle: "@Rebel44CZ", domain: "Multi", notes: "Oryx contributor. Updates when equipment loss lists are refreshed." },
  { id: "ralee85", name: "Rob Lee (FPRI)", platform: "X", handle: "@RALee85", domain: "Multi", notes: "Senior fellow at FPRI. Analysis of military systems and drone doctrine." },
  { id: "militaryland-x", name: "MilitaryLand.net (X)", platform: "X", handle: "@Militarylandnet", domain: "Multi", notes: "Front-line analysis and geolocated equipment updates." },
  { id: "markito0171", name: "Markito", platform: "X", handle: "@markito0171", domain: "Air", notes: "Ukrainian EW and drone commentary; technical frontline observations." },
  { id: "200-zoka", name: "200 Zoka", platform: "X", handle: "@200_zoka", domain: "Multi", notes: "Documents new UGV and FPV types with geotagged imagery." },
  { id: "nrg8000", name: "Nrg8000", platform: "X", handle: "@Nrg8000", domain: "Air", notes: "UAV tracking, FPV development and commercial drone militarisation." },
  // --- Maritime, teardown & EW ---
  { id: "covert-shores", name: "Covert Shores (H I Sutton)", platform: "RSS", handle: "https://www.hisutton.com/feed.xml", domain: "Sea", notes: "Naval drones, USVs and UUVs (MAGURA, Sea Baby) with line drawings." },
  { id: "naval-news", name: "Naval News", platform: "RSS", handle: "https://www.navalnews.com/feed/", domain: "Sea", notes: "Black Sea maritime drone warfare and naval countermeasures.", autoSync: true },
  { id: "car-teardowns", name: "Conflict Armament Research", platform: "RSS", handle: "https://www.conflictarm.com/feed/", domain: "Multi", notes: "Physical teardowns of downed drones; component serials, supply chains, CRPA modules." },
  { id: "ares", name: "Armament Research Services", platform: "RSS", handle: "https://armamentresearch.com/feed/", domain: "Multi", notes: "Technical munition reports, FPV warheads and improvised payloads." },
  { id: "c4isrnet", name: "C4ISRNET", platform: "RSS", handle: "https://www.c4isrnet.com/arc/outboundfeeds/rss/", domain: "Multi", notes: "EW, RF spectrum, jammers and counter-drone procurement.", autoSync: true },
  { id: "kiber-boroshno", name: "KiberBoroshno", platform: "Telegram", handle: "@kiber_boroshno", domain: "Air", notes: "UA technical OSINT: launch sites, wreckage and telemetry hardware." },
  { id: "warspotting", name: "WarSpotting", platform: "Web", handle: "https://warspotting.net/", domain: "Multi", notes: "Photo-verified loss database with exact variant identification." },

  // --- Reddit RSS Feeds ---
  { id: "reddit-war-in-ukraine", name: "Reddit: WarInUkraine", platform: "RSS", handle: "https://www.reddit.com/r/WarInUkraine/new/.rss", domain: "Multi", notes: "Community aggregation of frontline drone/UGV footage and technical analysis. High volume, filter aggressively.", autoSync: true },
  { id: "reddit-ukraine", name: "Reddit: Ukraine", platform: "RSS", handle: "https://www.reddit.com/r/ukraine/new/.rss", domain: "Multi", notes: "Broader Ukraine conflict discussion. High noise-to-signal ratio, filter with DRONE_HINT.", autoSync: false },
];

/**
 * Seeded sources that have been removed because they duplicate another source's content.
 *
 * SEED_SOURCES only ever *adds* rows (see LocalSourceRepository.addMissingDefaults), so an install
 * that already stored a retired source keeps polling it. This list lets such an install drop them;
 * it is deliberately a separate list rather than inferred from the seed, so removing an entry from
 * SEED_SOURCES is never silently treated as a delete.
 *
 * A retired id must not come back through addMissingDefaults, hence ACTIVE_SEED_SOURCES below.
 */
export const RETIRED_SOURCE_IDS = ["bellingcat-news"] as const;

/** Seed rows that are still wanted, i.e. the seed minus anything retired. */
export const ACTIVE_SEED_SOURCES: MonitoredSource[] = SEED_SOURCES.filter(
  (s) => !(RETIRED_SOURCE_IDS as readonly string[]).includes(s.id),
);

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
