import type { Lexicon } from "./types";

/** Swedish - Saab and other Swedish systems appear in Swedish-language sources. */
export const sv: Lexicon = {
  lang: "sv",
  money: {
    magnitudes: {
      thousand: ["tusen"],
      million: ["miljoner", "miljon", "milj"],
      billion: ["miljarder", "miljard", "mdr"],
    },
    currencies: {
      SEK: ["kronor", "SEK", "kr"],
      USD: ["dollar"],
      EUR: ["euro"],
    },
    // "50 mkr" is one token carrying both the magnitude and the currency.
    compounds: [
      { word: "tkr", scale: "thousand", currency: "SEK" },
      { word: "mkr", scale: "million", currency: "SEK" },
      { word: "mdkr", scale: "billion", currency: "SEK" },
    ],
    unitPriceCues: ["styckpris", "per styck", "kostar", "\\bpris\\b", "à"],
    totalCues: ["\\bavtal", "\\bkontrakt", "\\bbeställning", "\\bbudget", "värt", "\\btotalt"],
  },
  units: {
    km: ["km", "kilometer"],
    m: ["m", "meter"],
    kg: ["kg"],
    hours: ["timmar", "timme", "tim"],
    minutes: ["minuter", "min"],
    kmh: ["km\\/tim"],
    watt: ["W", "watt"],
    kilowatt: ["kW"],
  },
  cues: {
    speed: ["hastighet", "marschfart"],
    range: ["räckvidd", "räckvidden"],
    endurance: ["flygtid", "uthållighet"],
    altitude: ["flyghöjd", "tjänstetopphöjd", "höjd"],
    wingspan: ["vingbredd", "spännvidd"],
    payload: ["last(?:förmåga)?", "nyttolast"],
    warhead: ["stridsdel", "sprängladdning"],
    ugvLoad: ["lastkapacitet", "dragförmåga"],
    ugvOperatingTime: ["drifttid", "batteritid"],
    jammingPower: ["störeffekt", "uteffekt"],
    suppressionRadius: ["störradie", "skyddsradie", "effektiv räckvidd"],
    engagementRange: ["bekämpningsräckvidd", "bekämpar mål på"],
    detectionRange: ["upptäcktsavstånd", "upptäcktsräckvidd", "upptäcker mål på"],
    targetAltitude: ["bekämpningshöjd"],
    targetSpeed: ["målhastighet"],
    targetChannels: ["målkanaler", "samtidiga mål"],
    length: ["längd", "lång"],
    height: ["höjd", "hög"],
    width: ["bredd", "bred"],
    diameter: ["diameter", "kaliber"],
    weightMtow: ["max startvikt", "maximal startvikt", "mtow"],
    weightEmpty: ["tomvikt", "tömvikt", "nettovikt"],
    weightLaunch: ["startvikt", "startmassa", "väger"],
  },
};
