import { useState } from "react";
import { storedTerm, resolveTerm, type TaxonomyCandidate } from "@/entities/normalization/taxonomy";
import { useServices, useTaxonomies, useTaxonomyCandidates } from "@/shared/infra/services";
import { Btn, Panel, Tag } from "@/shared/ui/primitives";

function slug(raw: string) {
  return (
    raw
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\u0400-\u04ff]+/g, "-")
      .replace(/^-|-$/g, "") || "term"
  );
}


function recommendCandidate(candidate: TaxonomyCandidate, options: ReturnType<typeof Object>) {
  // resolveTerm returns one canonical id when the raw text uniquely matches an alias.
  const resolution = resolveTerm(candidate.rawTerm, candidate.taxonomy, options as any);
  if (resolution.canonicalId) {
    const match = (options as any[]).find((t) => t.canonicalId === resolution.canonicalId);
    return {
      canonicalId: resolution.canonicalId,
      label: match?.label ?? resolution.canonicalId,
      confidence: resolution.confidence,
    };
  }
  const sameSlug = (options as any[]).find(
    (t) => t.canonicalId === slug(candidate.rawTerm),
  );
  return sameSlug
    ? { canonicalId: sameSlug.canonicalId, label: sameSlug.label, confidence: 0.6 }
    : null;
}

function candidateNoiseScore(rawTerm: string): number {
  const t = rawTerm.toLowerCase();
  if (t.length < 2) return -30;
  // Long free-form text is much more likely to be report prose than a vehicle trait.
  const wordCount = t.split(/\s+/).filter((w) => w.length > 1).length;
  if (wordCount >= 5) return -25;
  if (/brigade|battalion|regiment|news|agency|ministry|operator|report|city|region|force/i.test(t))
    return -25;
  return 0;
}

function candidateReviewScore(candidate: TaxonomyCandidate, options: any[]) {
  const recommendation = recommendCandidate(candidate, options);
  let score = recommendation ? 100 : 0;
  score += Math.min(candidate.occurrences, 25);
  score += candidateNoiseScore(candidate.rawTerm);
  return score;
}

const TAXONOMY_GUIDANCE = {
  propulsion: {
    label: "Propulsion / drive mode",
    summary: "How the whole system moves: electrical, internal-combustion, jet, turbofan, turboprop, hybrid, rocket, waterjet, outboard, or unpowered. Electric and waterjet answer different movement questions, so both can be canonical.",
    examples: "Map 'BLDC' to electric, 'outboard motor' to outboard, '2-stroke' to piston.",
  },
  installation: {
    label: "Platform / installation",
    summary: "The platform or airframe and how it is mounted: multirotor, fixed-wing, VTOL, tracked, wheeled, mast-mounted, vehicle-dome, etc. Separate from propulsion.",
    examples: "Map 'tracks' to tracked and 'multicopter' to multirotor.",
  },
  protocol: {
    label: "RF / link protocol",
    summary: "Comms, jamming, telemetry, CRPA and navigation protocols. Values come from the raw text and are kept separate from movement terms.",
    examples: "Map 'Kometa' to CRPA and 'Express LRS' to ExpressLRS.",
  },
};


function recommendTaxonomy(candidate: TaxonomyCandidate, terms: any[]) {
  let best: { taxonomy: string; canonicalId: string; label: string; confidence: number } | null = null;
  for (const taxonomy of ["propulsion", "installation", "protocol"]) {
    const options = terms.filter((t: any) => t.taxonomy === taxonomy && t.status === "active");
    const resolution = resolveTerm(candidate.rawTerm, taxonomy, options);
    if (resolution.canonicalId && (!best || resolution.confidence > best.confidence)) {
      const match = options.find((t: any) => t.canonicalId === resolution.canonicalId);
      best = {
        taxonomy,
        canonicalId: resolution.canonicalId,
        label: match?.label ?? resolution.canonicalId,
        confidence: resolution.confidence,
      };
    }
  }
  // Common sight reports: these look like platform mobility, not energy/drive.
  if (!best && /4x4|4wd|awd|wheeled/i.test(candidate.rawTerm)) {
    best = { taxonomy: "installation", canonicalId: "wheeled", label: "Wheeled", confidence: 0.8 };
  }
  // A generic propeller usually describes an airframe/thrust arrangement, not an engine cycle.
  if (!best && /^propellers?$/i.test(candidate.rawTerm.trim())) {
    best = { taxonomy: "installation", canonicalId: "fixed-wing", label: "Fixed wing", confidence: 0.6 };
  }
  return best;
}
export function TaxonomyPage() {
  const terms = useTaxonomies();
  const candidates = useTaxonomyCandidates();
  const { taxonomies, taxonomyCandidates } = useServices();
  const [target, setTarget] = useState<Record<string, string>>({});
  const [targetTaxonomy, setTargetTaxonomy] = useState<Record<string, string>>({});
  const [aliasFor, setAliasFor] = useState(terms[0]?.id ?? "");
  const [alias, setAlias] = useState("");
  const open = candidates.filter((c) => c.status === "candidate");

  const mapTo = (id: string, taxonomy: string, rawTerm: string, canonicalId: string) => {
    const term = terms.find((t) => t.taxonomy === taxonomy && t.canonicalId === canonicalId);
    if (term && !term.aliases.some((a) => a.toLowerCase() === rawTerm.toLowerCase())) {
      taxonomies.upsertTerm({
        ...term,
        aliases: [...term.aliases, rawTerm],
        origin: "db",
        updatedAt: new Date().toISOString(),
      });
    }
    taxonomyCandidates.resolve(id, "mapped", canonicalId);
  };

  const promote = (id: string, taxonomy: string, rawTerm: string) => {
    const canonicalId = slug(rawTerm);
    taxonomies.upsertTerm(
      storedTerm(
        {
          taxonomy,
          canonicalId,
          label: rawTerm,
          aliases: [rawTerm],
          status: "active",
          origin: "db",
        },
        { updatedAt: new Date().toISOString() },
      ),
    );
    taxonomyCandidates.resolve(id, "promoted", canonicalId);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold">Taxonomy</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          Unknown propulsion and installation terms stay candidates until you map or promote them.
          Nothing here becomes canonical on its own.
        </p>
      </div>
      <Panel title="Canonical taxonomies">
        <div className="grid gap-3 md:grid-cols-3">
          {Object.entries(TAXONOMY_GUIDANCE).map(([taxonomy, info]) => (
            <div key={taxonomy} className="border border-border bg-background/40 p-3">
              <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
                {taxonomy}
              </p>
              <h2 className="mt-1 text-sm font-semibold">{info.label}</h2>
              <p className="mt-2 text-xs text-muted-foreground">{info.summary}</p>
              <p className="mt-2 font-mono text-[11px] text-muted-foreground">Examples: {info.examples}</p>
              <p className="mt-2 text-xs">
                Active terms: {terms.filter((t) => t.taxonomy === taxonomy && t.status === "active").length}
              </p>
            </div>
          ))}
        </div>
      </Panel>
      <Panel title={`Candidates (${open.length})`}>
        {open.length === 0 && <p className="text-sm text-muted-foreground">No unresolved terms.</p>}
        <ul className="space-y-4">
          {open.map((c) => {
            const taxonomyHint = recommendTaxonomy(c, terms);
            const chosenTaxonomy =
              targetTaxonomy[c.id] || taxonomyHint?.taxonomy || c.taxonomy;
            const options = terms.filter(
              (t) => t.taxonomy === chosenTaxonomy && t.status === "active",
            );
            const recommendation = recommendCandidate(c, options);
            const chosen =
              target[c.id] ||
              (taxonomyHint?.taxonomy === chosenTaxonomy ? taxonomyHint?.canonicalId : undefined) ||
              recommendation?.canonicalId ||
              options[0]?.canonicalId ||
              "";
            return (
              <li key={c.id} className="border border-border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Tag tone="accent">{TAXONOMY_GUIDANCE[c.taxonomy as keyof typeof TAXONOMY_GUIDANCE]?.label ?? c.taxonomy}</Tag>
                  <span className="font-medium">{c.rawTerm}</span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {c.occurrences} seen
                  </span>
                </div>
                <p className="mt-1 font-mono text-xs text-muted-foreground">
                  {c.sources.map((s) => s.source).join(" · ") || "No source recorded"}
                {taxonomyHint && taxonomyHint.taxonomy !== c.taxonomy && (
                  <p className="mt-1 font-mono text-xs text-accent">
                    Suggested taxonomy: {TAXONOMY_GUIDANCE[taxonomyHint.taxonomy as keyof typeof TAXONOMY_GUIDANCE]?.label ?? taxonomyHint.taxonomy} / {taxonomyHint.label}
                  </p>
                )}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <select
                    value={chosenTaxonomy}
                    onChange={(e) => {
                      setTargetTaxonomy((prev) => ({ ...prev, [c.id]: e.target.value }));
                      setTarget((prev) => ({ ...prev, [c.id]: "" }));
                    }}
                    className="border border-border bg-transparent px-2 py-1 font-mono text-xs"
                    aria-label="Taxonomy"
                  >
                    {["propulsion", "installation", "protocol"].map((taxonomy) => (
                      <option key={taxonomy} value={taxonomy} className="bg-card">
                        {TAXONOMY_GUIDANCE[taxonomy as keyof typeof TAXONOMY_GUIDANCE]?.label ?? taxonomy}
                      </option>
                    ))}
                  </select>
                  <select
                    value={chosen}
                    onChange={(e) => setTarget((prev) => ({ ...prev, [c.id]: e.target.value }))}
                    className="border border-border bg-transparent px-2 py-1 font-mono text-xs"
                    aria-label="Canonical term"
                  >
                    {options.map((t) => (
                      <option key={t.id} value={t.canonicalId} className="bg-card">
                        {t.label}
                      </option>
                    ))}
                  </select>
                  <Btn
                    variant="ghost"
                    disabled={!chosen}
                    onClick={() => mapTo(c.id, chosenTaxonomy, c.rawTerm, chosen)}
                  >
                    Map to selected taxonomy
                  </Btn>
                  <Btn onClick={() => promote(c.id, c.taxonomy, c.rawTerm)}>Promote</Btn>
                  <Btn
                    variant="danger"
                    onClick={() => taxonomyCandidates.resolve(c.id, "rejected")}
                  >
                    Reject
                  </Btn>
                </div>
              </li>
            );
          })}
        </ul>
      </Panel>
  <Panel title="Aliases">
    <p className="mb-3 text-xs text-muted-foreground">
      Aliases mean: "next time this raw phrase appears, resolve it to the canonical term." Use Map on a candidate for one phrase or many repeated phrases; promote only when no current canonical fits; reject noise. This panel manually attaches extra synonyms to an already canonical term.
    </p>
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const term = terms.find((t) => t.id === aliasFor);
            const next = alias.trim();
            if (!term || !next) return;
            if (!term.aliases.some((a) => a.toLowerCase() === next.toLowerCase())) {
              taxonomies.upsertTerm({
                ...term,
                aliases: [...term.aliases, next],
                origin: "db",
                updatedAt: new Date().toISOString(),
              });
            }
            setAlias("");
          }}
        >
          <select
            value={aliasFor}
            onChange={(e) => setAliasFor(e.target.value)}
            className="border border-border bg-transparent px-2 py-1 font-mono text-xs"
          >
            {terms
              .filter((t) => t.status === "active")
              .map((t) => (
                <option key={t.id} value={t.id} className="bg-card">
                  {t.taxonomy}: {t.label}
                </option>
              ))}
          </select>
          <input
            value={alias}
            onChange={(e) => setAlias(e.target.value)}
            placeholder="New alias"
            className="border border-border bg-transparent px-2 py-1 text-sm"
          />
          <Btn type="submit" disabled={!alias.trim()}>
            Add alias
          </Btn>
        </form>
      </Panel>
    </div>
  );
}
