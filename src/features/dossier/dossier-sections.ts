/** Dossier section order: the section nav and the mobile jump menu both read it. */
export const DOSSIER_SECTIONS = [
  { id: "specs", label: "Specifications" },
  { id: "aliases", label: "Aliases" },
  { id: "related", label: "Related intel" },
  { id: "rf", label: "RF spectrum" },
  { id: "supply", label: "Supply chain" },
  { id: "contracts", label: "Procurement" },
  { id: "activity", label: "Activity" },
  { id: "payloads", label: "Payloads" },
  { id: "sensors", label: "Sensors" },
  { id: "variants", label: "Relations" },
  { id: "counterparts", label: "Counterparts" },
  { id: "timeline", label: "Timeline" },
  { id: "claims", label: "Claim timeline" },
] as const;
