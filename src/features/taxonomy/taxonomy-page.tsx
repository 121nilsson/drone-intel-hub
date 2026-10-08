import { useState } from "react";
import { storedTerm } from "@/entities/normalization/taxonomy";
import { useServices, useTaxonomies, useTaxonomyCandidates } from "@/shared/infra/services";
import { Btn, Panel, Tag } from "@/shared/ui/primitives";

function slug(raw: string) {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u0400-\u04ff]+/g, "-")
    .replace(/^-|-$/g, "") || "term";
}

export function TaxonomyPage() {
  const terms = useTaxonomies();
  const candidates = useTaxonomyCandidates();
  const { taxonomies, taxonomyCandidates } = useServices();
  const [target, setTarget] = useState<Record<string, string>>({});
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
        { taxonomy, canonicalId, label: rawTerm, aliases: [rawTerm], status: "active", origin: "db" },
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
          Unknown propulsion and installation terms stay candidates until you map or promote them. Nothing here becomes canonical on its own.
        </p>
      </div>
      <Panel title={`Candidates (${open.length})`}>
        {open.length === 0 && <p className="text-sm text-muted-foreground">No unresolved terms.</p>}
        <ul className="space-y-4">
          {open.map((c) => {
            const options = terms.filter((t) => t.taxonomy === c.taxonomy && t.status === "active");
            const chosen = target[c.id] || options[0]?.canonicalId || "";
            return (
              <li key={c.id} className="border border-border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Tag tone="accent">{c.taxonomy}</Tag>
                  <span className="font-medium">{c.rawTerm}</span>
                  <span className="font-mono text-xs text-muted-foreground">{c.occurrences} seen</span>
                </div>
                <p className="mt-1 font-mono text-xs text-muted-foreground">
                  {c.sources.map((s) => s.source).join(" · ") || "No source recorded"}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <select
                    value={chosen}
                    onChange={(e) => setTarget((prev) => ({ ...prev, [c.id]: e.target.value }))}
                    className="border border-border bg-transparent px-2 py-1 font-mono text-xs"
                  >
                    {options.map((t) => (
                      <option key={t.id} value={t.canonicalId} className="bg-card">{t.label}</option>
                    ))}
                  </select>
                  <Btn variant="ghost" disabled={!chosen} onClick={() => mapTo(c.id, c.taxonomy, c.rawTerm, chosen)}>Map</Btn>
                  <Btn onClick={() => promote(c.id, c.taxonomy, c.rawTerm)}>Promote</Btn>
                  <Btn variant="danger" onClick={() => taxonomyCandidates.resolve(c.id, "rejected")}>Reject</Btn>
                </div>
              </li>
            );
          })}
        </ul>
      </Panel>
      <Panel title="Aliases">
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const term = terms.find((t) => t.id === aliasFor);
            const next = alias.trim();
            if (!term || !next) return;
            if (!term.aliases.some((a) => a.toLowerCase() === next.toLowerCase())) {
              taxonomies.upsertTerm({ ...term, aliases: [...term.aliases, next], origin: "db", updatedAt: new Date().toISOString() });
            }
            setAlias("");
          }}
        >
          <select value={aliasFor} onChange={(e) => setAliasFor(e.target.value)} className="border border-border bg-transparent px-2 py-1 font-mono text-xs">
            {terms.filter((t) => t.status === "active").map((t) => (
              <option key={t.id} value={t.id} className="bg-card">{t.taxonomy}: {t.label}</option>
            ))}
          </select>
          <input
            value={alias}
            onChange={(e) => setAlias(e.target.value)}
            placeholder="New alias"
            className="border border-border bg-transparent px-2 py-1 text-sm"
          />
          <Btn type="submit" disabled={!alias.trim()}>Add alias</Btn>
        </form>
      </Panel>
    </div>
  );
}
