# Drone Intel Hub — Curated Source List

> [!NOTE]
> All sources in this list are publicly accessible without login or payment.
> Handles and URLs have been verified against live search results as of October 2026.
> **Reliability ratings** reflect how often a source's claims are independently confirmed —
> not political alignment. All sources carry some bias; treat nothing here as ground truth.
>
> The app currently supports four platform types:
> - **Telegram** — scraped via `t.me/s/<handle>` (public web preview, ~20 latest posts)
> - **RSS** — standard Atom/RSS feed URL
> - **Web** — any public HTTPS page (anchor-text parser only; full-article extraction is not implemented)
> - **X** — @handle only; requires paid API, currently unsupported in the ingest pipeline

---

## Already Seeded (do not re-add)

| Name | Platform | Handle / URL | Domain |
|---|---|---|---|
| Wild Hornets | Telegram | `@wildhornets` | Air |
| Rybar | Telegram | `@rybar` | Multi |
| Two Majors (Dva Majors) | Telegram | `@dva_majors` | Land |
| The War Zone | RSS | `https://www.twz.com/feed` | Multi |
| Militarnyi | Web | `https://mil.in.ua/en/` | Multi |
| Defense Express | Web | `https://en.defence-ua.com/` | Multi |
| Bayraktar 1love | X | `@bayraktar_1love` | Air |

---

## Telegram Channels

### Ukrainian OSINT / Analytical — High Signal

| ID | Name | Handle | Domain | Lang | Reliability | Notes |
|---|---|---|---|---|---|---|
| `serhii-flash` | Serhii Flash | `@serhii_flash` | Multi | UA | ⭐⭐⭐⭐⭐ | **Top pick.** Serhii Beskrestnov (call sign "Flash"), EW advisor to Ukrainian MoD. Deep technical analysis of RF systems, drone frequencies, jammer specs, captured hardware. Primary source for EW and radio intelligence. |
| `citeam` | Conflict Intelligence Team | `@citeam` | Multi | RU | ⭐⭐⭐⭐⭐ | Independent OSINT investigators. Geolocation of units, equipment identification, supply chain tracking. Claims are verified with imagery evidence. Language: Russian. |
| `molfar-global` | Molfar OSINT | `@molfar_global` | Multi | UA/EN | ⭐⭐⭐⭐ | Ukrainian professional OSINT agency. Investigations into Russian drone launch infrastructure, component supply chains, sanctions violations. High-quality sourcing. |
| `frontelligence` | Frontelligence Insight | `@frontelligence` | Multi | EN | ⭐⭐⭐⭐ | English-language OSINT analysis. Tracks drone innovations, EW tactics, and frontline technology deployments. Good for non-Cyrillic readers. |
| `astra-ukraine` | ASTRA | `@astra_ukr` | Multi | RU/UA | ⭐⭐⭐⭐ | Investigative journalism collective. Documents Russian war crimes and military logistics. Strong on supply chain exposés (Chinese components in Shahed, etc.). |
| `war-translated` | War Translated | `@wartranslated` | Multi | EN | ⭐⭐⭐⭐ | Translates and summarises key Russian and Ukrainian milblog posts into English. Good aggregation point for non-Russian speakers. |
| `rezident-ua` | Rezident UA | `@rezident_ua` | Multi | UA | ⭐⭐⭐ | Ukrainian intelligence-adjacent channel. Often gets early leaks on new Russian drone variants. Cross-check before trusting exclusive claims. |
| `ukraine-weapons` | Ukraine Weapons Tracker | `@ukraine_weapons` | Multi | EN | ⭐⭐⭐⭐ | Documents and identifies captured/destroyed equipment with imagery. Good for component and hardware identification. |

### Russian Milbloggers — Low Reliability, High Volume

> [!WARNING]
> Russian milblogger channels are valuable for **early signals** on new Russian systems, but
> claims are frequently exaggerated, unverified, or deliberate disinformation. Set a **low
> auto-merge threshold** for candidates sourced from these channels. Mark in `notes`.

| ID | Name | Handle | Domain | Lang | Reliability | Notes |
|---|---|---|---|---|---|---|
| `fighter-bomber` | Fighterbomber | `@fighter_bomber` | Air | RU | ⭐⭐ | Russian VKS (air force) pilot blogger. Useful for reporting on UAV/drone interactions with manned aviation and Russian air doctrine. Treat all specs as unverified. |
| `intelslava` | Intel Slava Z | `@intelslava` | Multi | RU | ⭐ | High-volume pro-Russian aggregator. Useful only for signal detection — a drone name appearing here is worth escalating to Tier 2 extraction. Claims unreliable. |
| `grey-zone` | Grey Zone | `@grey_zone` | Multi | RU | ⭐⭐ | Connected to Wagner/Russian private military. Early reports on new munitions and drone variants. Cross-check all technical specs against Ukrainian or Western sources. |
| `wargonzo` | Wargonzo | `@wargonzo` | Multi | RU | ⭐⭐ | Russian war correspondent channel. Embeds with front-line units; sometimes first to document new UGV or FPV types before official announcements. |

### International OSINT & Monitoring

| ID | Name | Handle | Domain | Lang | Reliability | Notes |
|---|---|---|---|---|---|---|
| `militaryland` | MilitaryLand.net | `@militaryland` | Multi | EN | ⭐⭐⭐⭐ | Maps and documents front-line changes. Occasionally first to document new drone/UGV types with geotagged imagery. |
| `defense-blog-tg` | Defence Blog | `@defence_blog` | Multi | EN | ⭐⭐⭐ | International defence news aggregator. Broader than UA/RU conflict — covers global UAV developments, new platform announcements. |
| `osint-ua` | OSINT Ukraine | `@osintua` | Multi | EN/UA | ⭐⭐⭐ | Community OSINT hub. Aggregates and verifies footage from multiple sources. Good for corroboration. |

---

## RSS Feeds

### Primary — Direct Feed URLs (Verified)

| ID | Name | Feed URL | Domain | Lang | Reliability | Notes |
|---|---|---|---|---|---|---|
| `breaking-defense` | Breaking Defense | `https://breakingdefense.com/feed` | Multi | EN | ⭐⭐⭐⭐ | US-focused defense trade press. Long-form coverage of drone programs, procurement, DARPA projects. Good for Western system specs and contract data. |
| `defense-news-rss` | Defense News | `https://www.defensenews.com/arc/outboundfeeds/rss/` | Multi | EN | ⭐⭐⭐⭐ | Global defense trade publication. Strong on procurement, contracts, and new platform introductions. |
| `defense-one` | Defense One | `https://www.defenseone.com/rss/all/` | Multi | EN | ⭐⭐⭐⭐ | Policy and technology focus. Good for US DoD drone strategy, counterdrone procurement. |
| `rusi-rss` | RUSI | `https://www.rusi.org/rss/whats-new.xml` | Multi | EN | ⭐⭐⭐⭐⭐ | Royal United Services Institute. Authoritative analytical papers on drone warfare, EW, supply chains. Lower volume but very high quality. |
| `bellingcat` | Bellingcat | `https://www.bellingcat.com/feed/` | Multi | EN | ⭐⭐⭐⭐⭐ | Gold standard for OSINT verification. Frequent investigations into drone component origins, supply chain tracking, and sanctions evasion. |
| `bellingcat-news` | Bellingcat News | `https://www.bellingcat.com/news/feed/` | Multi | EN | ⭐⭐⭐⭐⭐ | Bellingcat news category feed — more frequent, shorter posts than the main feed. |
| `ukrinform-war` | Ukrinform (War) | `https://www.ukrinform.net/rss/rubric-war` | Multi | EN | ⭐⭐⭐ | Official Ukrainian state news agency, war section. Good for MoD announcements, confirmed strike reports, new system deployments. |
| `defence-blog-rss` | Defence Blog | `https://defence-blog.com/feed/` | Multi | EN | ⭐⭐⭐ | International defence news. Covers global UAV developments, new platform announcements, captured hardware analysis. |
| `militarnyi-rss` | Militarnyi (UA) | `https://mil.in.ua/uk/news/feed/` | Multi | UA | ⭐⭐⭐⭐ | Ukrainian-language feed from Militarnyi. More content than the English web version. Use with UA-capable LLM model. |

### Secondary — Broader Defense Context

| ID | Name | Feed URL | Domain | Lang | Reliability | Notes |
|---|---|---|---|---|---|---|
| `ukrinform-main` | Ukrinform (All) | `https://www.ukrinform.net/rss` | Multi | EN | ⭐⭐⭐ | Broader Ukrinform feed. Filter aggressively with DRONE_HINT — high noise-to-signal ratio. |

---

## Web Sources (Scrapable Articles)

> [!NOTE]
> Web sources use the anchor-text parser, which captures link text rather than article
> bodies. Full-article extraction is proposed but not implemented — see
> `improvements2.md §1-B` and `improvements3.md §1.7`.

| ID | Name | URL | Domain | Lang | Reliability | Notes |
|---|---|---|---|---|---|---|
| `kyiv-independent-war` | Kyiv Independent (War) | `https://kyivindependent.com/tag/war/` | Multi | EN | ⭐⭐⭐⭐ | Independent Ukrainian journalism. Regular coverage of new drone deployments, EW developments, and Ukrainian industry. No native RSS; use Web platform. |
| `isw-updates` | ISW Daily Updates | `https://understandingwar.org/backgrounder/ukraine-conflict-updates` | Multi | EN | ⭐⭐⭐⭐ | Institute for the Study of War. Daily campaign assessments with equipment and tactic analysis. No RSS; Web scrape only. |
| `oryxspioenkop` | Oryx Equipment Losses | `https://www.oryxspioenkop.com/2022/02/attack-on-europe-documenting-equipment.html` | Multi | EN | ⭐⭐⭐⭐⭐ | Visual evidence-based equipment loss tracking. Invaluable for cross-referencing drone types and component identification. Single large page; update slowly. |
| `army-recognition` | Army Recognition | `https://www.armyrecognition.com/` | Multi | EN | ⭐⭐⭐ | International defence news. Good for global UAV program announcements, arms fair coverage (DSEI, Eurosatory). No reliable RSS; use Web platform. |
| `ua-mod-press` | Ukraine MoD Press | `https://www.mil.gov.ua/en/news/` | Multi | EN | ⭐⭐⭐ | Official Ukrainian Ministry of Defence press releases. Good for confirmed deployments and official spec disclosures. Low volume, high authority. |
| `drone-below` | Drone Below | `https://dronebelow.com/` | Air | EN | ⭐⭐ | Commercial and military drone news. Useful for global civilian drone platform tracking that sometimes crosses into military use (DJI Mavic variants, etc.). |

---

## Drone Manufacturers & Defense Tech Clusters

### Ukrainian Manufacturers & DefenseTech

| ID | Name | Handle / URL | Platform | Domain | Reliability | Notes |
|---|---|---|---|---|---|---|
| `brave1-tg` | Brave1 Cluster (TG) | `@Brave1ua` | Telegram | Multi | ⭐⭐⭐⭐⭐ | Official Ukrainian government DefenseTech coordination platform & marketplace. Announcements of tested/certified UAV, UGV, USV, and EW systems. |
| `brave1-web` | Brave1 DefenseTech Hub | `https://brave1.gov.ua/en/` | Web | Multi | ⭐⭐⭐⭐⭐ | Official Brave1 portal. Details on certified Ukrainian military robotics, grant programs, and manufacturer specifications. |
| `ukrspecsystems` | Ukrspecsystems | `https://ukrspecsystems.com/news` | Web | Air | ⭐⭐⭐⭐⭐ | Primary Ukrainian tactical UAV manufacturer. Maker of SHARK, SHARK-M, PD-2, and Gekata airborne SIGINT/EW complex. |
| `skyeton` | Skyeton | `https://skyeton.com/news` | Web | Air | ⭐⭐⭐⭐⭐ | Ukrainian manufacturer of the Raybird-3 (ACS-3) long-endurance tactical reconnaissance UAV system. |
| `deviro` | DeViRo | `https://deviro.ua/` | Web | Air | ⭐⭐⭐⭐ | Ukrainian unmanned aviation company. Maker of the Leleka-100 reconnaissance drone and Leleka-LR. |
| `airlogix` | Airlogix | `https://airlogix.io/` | Web | Air | ⭐⭐⭐⭐ | Ukrainian manufacturer of the Gor tactical reconnaissance drone designed for EW-contested environments. |
| `athlon-avia` | Athlon Avia | `https://athlon.avia.ua/` | Web | Air | ⭐⭐⭐⭐ | Ukrainian defense manufacturer. Maker of the A1-CM Furia artillery reconnaissance and fire correction UAV. |

### Western & Allied Drone Manufacturers

| ID | Name | Handle / URL | Platform | Domain | Reliability | Notes |
|---|---|---|---|---|---|---|
| `aerovironment` | AeroVironment | `https://www.avinc.com/news/` | Web | Air | ⭐⭐⭐⭐⭐ | Major US tactical drone manufacturer. Maker of Switchblade 300/600 loitering munitions, Puma 3 AE, Raven, and LOCUST directed energy C-UAS. |
| `anduril` | Anduril Industries | `https://www.anduril.com/newsroom/` | Web | Multi | ⭐⭐⭐⭐⭐ | US defense tech company. Maker of Ghost-X, Altius-600/700, Roadrunner jet interceptor, Dive-LD AUV, and Lattice OS. |
| `quantum-systems` | Quantum-Systems | `https://quantum-systems.com/news/` | Web | Air | ⭐⭐⭐⭐⭐ | German eVTOL drone maker. Manufacturer of Vector, Scorpion, and AI interceptor drones widely deployed in Ukraine. |
| `wb-group` | WB Group | `https://www.wbgroup.pl/en/news/` | Web | Air | ⭐⭐⭐⭐⭐ | Leading Polish defense electronics & UAV manufacturer. Maker of Warmate loitering munitions, FlyEye UAV, and Topaz combat management system. |
| `baykar` | Baykar Tech | `https://baykartech.com/en/press/` | Web | Air | ⭐⭐⭐⭐⭐ | Turkish unmanned aerospace manufacturer. Maker of Bayraktar TB2, TB3, Akinci, and Kizilelma unmanned fighter. |
| `stm-turkey` | STM Savunma | `https://www.stm.com.tr/en/press-releases` | Web | Multi | ⭐⭐⭐⭐⭐ | Turkish state defense contractor. Maker of Kargu rotary loitering munition, Boyga mortar-dropping UAV, and Togan scout drone. |
| `skydio` | Skydio | `https://www.skydio.com/newsroom` | Web | Air | ⭐⭐⭐⭐ | US autonomous drone manufacturer. Maker of Skydio X2D / X10D autonomous reconnaissance platforms. |
| `shield-ai` | Shield AI | `https://shield.ai/news` | Web | Air | ⭐⭐⭐⭐⭐ | US defense autonomy company. Maker of the V-BAT long-endurance VTOL drone and Hivemind GPS-denied autonomous pilot. |
| `helsing` | Helsing AI | `https://helsing.ai/news` | Web | Multi | ⭐⭐⭐⭐ | European defense AI firm. Supplies AI-assisted sensor processing and autonomous drone strike software for front-line applications. |
| `kratos` | Kratos Defense | `https://ir.kratosdefense.com/press-releases` | Web | Air | ⭐⭐⭐⭐ | US high-performance unmanned systems manufacturer. Developer of XQ-58A Valkyrie and jet-powered tactical drones. |
| `defsecintel` | DefSecIntel | `https://defsecintel.com/` | Web | Multi | ⭐⭐⭐⭐ | Estonian defense AI & autonomous surveillance manufacturer. Maker of SmartWatcher AI towers and mobile drone surveillance systems deployed in Ukraine. |

---

## Counter-UAS, EW & Sensor Systems

| ID | Name | Handle / URL | Platform | Domain | Reliability | Notes |
|---|---|---|---|---|---|---|
| `droneshield` | DroneShield | `https://www.droneshield.com/media-insights` | Web | Multi | ⭐⭐⭐⭐⭐ | Australian C-UAS manufacturer. Maker of DroneGun, DroneSentinel, and RfPatrol wearable RF drone detection sensors. |
| `dedrone` | Dedrone | `https://www.dedrone.com/newsroom` | Web | Multi | ⭐⭐⭐⭐ | Airspace security & counter-drone technology company. RF signal classification, radar tracking, and mitigation systems. |
| `epirus` | Epirus | `https://www.epirusinc.com/news` | Web | Air | ⭐⭐⭐⭐ | US defense technology company. Maker of Leonidas high-power microwave (HPM) counter-electronics and drone swarm neutralization systems. |

---

## Open-Source Flight Firmware & Radio Links (Atom Feeds)

> [!TIP]
> GitHub releases provide instant Atom/RSS feeds by appending `/releases.atom`. These feeds track
> flight controller algorithms, RF frequency hopping, and optical guidance upgrades as they are committed.

| ID | Name | Feed URL | Platform | Domain | Reliability | Notes |
|---|---|---|---|---|---|---|
| `ardupilot-releases` | ArduPilot Releases | `https://github.com/ArduPilot/ardupilot/releases.atom` | RSS | Multi | ⭐⭐⭐⭐⭐ | Core autonomous flight navigation software for fixed-wing, VTOL, and ground/surface vehicles. Tracks GPS-denied navigation, optical flow, and return-home features. |
| `betaflight-releases` | Betaflight FPV Firmware | `https://github.com/betaflight/betaflight/releases.atom` | RSS | Air | ⭐⭐⭐⭐⭐ | Primary flight controller firmware for tactical FPV strike quadcopters. Tracks gyro filtering, motor protocols, and failsafe maneuvers. |
| `expresslrs-releases` | ExpressLRS Radio Link | `https://github.com/ExpressLRS/ExpressLRS/releases.atom` | RSS | Multi | ⭐⭐⭐⭐⭐ | High-performance open-source radio control link (868/915 MHz, 2.4 GHz). Key for tracking anti-jamming frequency hopping and telemetry modulation updates. |
| `openipc-releases` | OpenIPC Video Firmware | `https://github.com/OpenIPC/firmware/releases.atom` | RSS | Air | ⭐⭐⭐⭐⭐ | Open source IP camera firmware widely used in low-latency digital FPV video links and fiber/RF camera modules. |
| `inav-releases` | INAV Navigation Firmware | `https://github.com/iNavFlight/inav/releases.atom` | RSS | Air | ⭐⭐⭐⭐⭐ | Autonomous waypoint navigation and return-to-home software for long-range fixed-wing strike and reconnaissance drones. |

---

## Defense Procurement & Arms Sales Feeds

| ID | Name | Feed URL | Platform | Domain | Reliability | Notes |
|---|---|---|---|---|---|---|
| `dsca-arms-sales` | US DSCA Major Arms Sales | `https://www.dsca.mil/press-media/major-arms-sales/feed` | RSS | Multi | ⭐⭐⭐⭐⭐ | Official US Defense Security Cooperation Agency notifications. Authoritative disclosures of approved Foreign Military Sales (FMS) including UAV systems and munitions. |

---

## X / Twitter Sources

> [!IMPORTANT]
> X requires a paid API (Pro tier minimum) and is currently unsupported by the ingest pipeline.
> These handles are listed for future implementation when the `TelegramBot` or `X` platform adapter is added.

| Handle | Name | Domain | Notes |
|---|---|---|---|
| `@OSINTtechnical` | OSINT Technical | Multi | High-quality hardware identification from imagery. Frequent drone component analysis. |
| `@Rebel44CZ` | Jakub Janovsky (Oryx) | Multi | Oryx contributor. Posts updates when equipment loss lists are updated. |
| `@RALee85` | Rob Lee (FPRI) | Multi | Senior researcher at FPRI. Deep analysis of Russian military systems and drone doctrine. |
| `@Militarylandnet` | MilitaryLand.net | Multi | Maps and front-line analysis. Same source as TG channel above. |
| `@markito0171` | Markito | Air | Ukrainian EW and drone commentary. Often ahead of Telegram on new technical observations. |
| `@200_zoka` | 200 Zoka | Multi | Ukrainian OSINT. Documents new UGV and FPV types with geotagged imagery. |
| `@Nrg8000` | Nrg8000 | Air | UAV tracking and identification. Strong on FPV and commercial drone militarisation. |
| `@bayraktar_1love` | Bayraktar 1love | Air | Already seeded. Primary account is X, not Telegram. |

---

## Adding Sources to the App

Each source in this list maps directly to a `MonitoredSource` entry. Example for `serhii-flash`:

```ts
{
  id: "serhii-flash",
  name: "Serhii Flash",
  platform: "Telegram",
  handle: "@serhii_flash",
  domain: "Multi",
  notes: "Serhii Beskrestnov — Ukrainian EW advisor. Primary source for RF/frequency intelligence and drone tech analysis.",
  autoSync: true,
}
```

Fields to set per source:
- `autoSync: true` — for high-signal sources worth polling on every scheduled sync
- `autoSync: false` (or omit) — for noisy sources where manual sync is preferred
- `notes` — always include the reliability rating and bias flag for Russian sources

### Recommended `autoSync: true` Sources

These have the best signal-to-noise ratio for automated ingestion:

1. `@serhii_flash` — EW and RF intelligence
2. `@wildhornets` — already seeded, UA drone maker
3. `@Brave1ua` — Ukrainian defense tech cluster
4. `https://github.com/ExpressLRS/ExpressLRS/releases.atom` — radio link & anti-jam updates
5. `https://github.com/ArduPilot/ardupilot/releases.atom` — navigation autonomy updates
6. `https://breakingdefense.com/feed` — Western procurement and tech
7. `https://www.rusi.org/rss/whats-new.xml` — analytical depth
8. `https://www.bellingcat.com/feed/` — supply chain and component investigations
9. `https://defence-blog.com/feed/` — broad global UAV coverage
10. `@citeam` — verified OSINT analysis
11. `https://www.dsca.mil/press-media/major-arms-sales/feed` — major arms sales notices

### Recommended `autoSync: false` (Manual Sync) Sources

High volume or low reliability — worth monitoring occasionally but not on every cycle:

- `@intelslava` — very high noise, pro-RU bias
- `@fighter_bomber` — low reliability, but good early-warning for new systems
- `https://www.ukrinform.net/rss` — broad feed, many irrelevant posts
- `https://dronebelow.com/` — commercial focus, low conflict relevance

---

## Source Gaps to Fill Later

These categories have no coverage yet:

| Gap | Why it matters |
|---|---|
| **Patent feeds** (USPTO, EPO) | Tracks Chinese/Iranian drone manufacturer filings — early signal for new propulsion or RF designs |
| **Sanctions lists** (OFAC, EU, UK FCDO) | Flags newly-sanctioned component manufacturers before they appear in field reports |
| **ArXiv cs.RO / eess.SP** | Academic preprints on RF, autonomous flight — 6–12 months ahead of field deployment |
| **Reddit** | r/WarInUkraine, r/ukraine — community aggregation point, needs subreddit RSS URL |

