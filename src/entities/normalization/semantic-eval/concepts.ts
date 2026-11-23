/**
 * Phase 3.2 — canonical concept reference for the FROZEN evaluation snapshot.
 *
 * Pure: no I/O, no live-registry lookup at review time. The catalog is derived from the rule set
 * that produced the snapshot, not from the full code manifest: a concept can be registered in the
 * manifest yet absent from the snapshot that actually resolved the frame. A reviewer must only use
 * an id that appears in this catalog, and the catalog carries the snapshot id/hash so it can never
 * be mistaken for a reference to a different snapshot.
 */

import { CANONICAL_CONCEPTS, CANONICAL_MANIFEST_VERSION } from "../canonical-manifest";
import type { ReadonlySemanticSnapshot, SemanticAliasDefinition } from "../semantic-resolver";

export const CONCEPT_CATALOG_SCHEMA_VERSION = "1.0.0";

/** Guidance shared by every "bad canonical id" message the reviewer can hit. */
export const REGISTRY_GUIDANCE =
  "Inspect the valid ids with `npx tsx scripts/export-canonical-concepts.ts --report` " +
  "(grouped by family in `scripts/output/semantic-concepts.md`, filterable in " +
  "`scripts/output/semantic-concepts.csv`). If the concept is meaningful but absent from this " +
  "frozen registry, set verdict=registry_gap and describe it in note — never invent an id.";

export interface CanonicalConceptRef {
  readonly id: string;
  readonly label: string;
  /** Family prefix without the trailing dot, e.g. `speed`, used for grouping. */
  readonly family: string;
  readonly description: string;
  /** Aliases/wording present in THIS snapshot; empty when the snapshot has none. */
  readonly aliases: readonly string[];
}

export interface CanonicalConceptCatalog {
  readonly schemaVersion: string;
  readonly snapshotId: string;
  readonly snapshotHash: string;
  readonly manifestVersion: string;
  /** Deterministically sorted by id. */
  readonly concepts: readonly CanonicalConceptRef[];
}

/**
 * Build the reference for a snapshot. The valid ID set is the snapshot's canonical manifest, not
 * the rule set: the resolver's gate 0 resolves any manifest ID by exact identity, so a concept with
 * no alias rule is still available in this snapshot. Aliases are the raw keys and label tokens of
 * the rules that mention a concept (class 4 candidates included); a concept with no rule simply has
 * an empty alias list. The snapshot id/hash are stamped verbatim so the reference cannot be mistaken
 * for one built against a different frozen snapshot.
 */
export function buildConceptCatalog(
  rules: readonly SemanticAliasDefinition[],
  snapshot: ReadonlySemanticSnapshot,
): CanonicalConceptCatalog {
  // Gate 0 uses the code manifest, so a snapshot built against a different manifest version would
  // need a different concept set. Refuse to produce a misleading reference for one.
  if (snapshot.manifestVersion !== CANONICAL_MANIFEST_VERSION) {
    throw new Error(
      `snapshot ${snapshot.snapshotId} uses manifest ${snapshot.manifestVersion}, ` +
        `but the available concepts are from ${CANONICAL_MANIFEST_VERSION}`,
    );
  }
  const aliasesById = new Map<string, Set<string>>();
  const add = (id: string, alias: string): void => {
    if (alias.length === 0 || alias === id) return;
    const set = aliasesById.get(id) ?? new Set<string>();
    set.add(alias);
    aliasesById.set(id, set);
  };
  for (const rule of rules) {
    const ids: string[] =
      "canonicalId" in rule && rule.canonicalId !== undefined
        ? [rule.canonicalId]
        : [...rule.candidateCanonicalIds];
    const aliases = [rule.rawKey, ...(rule.labelTokens ?? [])];
    for (const id of ids) for (const alias of aliases) add(id, alias);
  }

  const concepts = CANONICAL_CONCEPTS.map((def): CanonicalConceptRef => ({
    id: def.id,
    label: def.label,
    family: def.family.replace(/\.$/, ""),
    description: def.description,
    aliases: [...(aliasesById.get(def.id) ?? [])].sort((a, b) => a.localeCompare(b)),
  })).sort((a, b) => a.id.localeCompare(b.id));
  return {
    schemaVersion: CONCEPT_CATALOG_SCHEMA_VERSION,
    snapshotId: snapshot.snapshotId,
    snapshotHash: snapshot.contentHash,
    manifestVersion: snapshot.manifestVersion,
    concepts,
  };
}

export function canonicalIdsInCatalog(catalog: CanonicalConceptCatalog): ReadonlySet<string> {
  return new Set(catalog.concepts.map((c) => c.id));
}

/** Actionable, snapshot-specific replacement for the old "not a canonical concept id" message. */
export function canonicalIdNotInSnapshotMessage(
  id: string,
  catalog: CanonicalConceptCatalog,
): string {
  return (
    `"${id}" is not a canonical id in snapshot ${catalog.snapshotId} ` +
    `(hash ${catalog.snapshotHash.slice(0, 12)}…). ${REGISTRY_GUIDANCE}`
  );
}

/** Deterministic markdown, grouped by family, headed by the exact snapshot identity. */
export function renderConceptCatalog(catalog: CanonicalConceptCatalog): string {
  const byFamily = new Map<string, CanonicalConceptRef[]>();
  for (const concept of catalog.concepts) {
    byFamily.set(concept.family, [...(byFamily.get(concept.family) ?? []), concept]);
  }
  const lines: string[] = [
    "# Canonical concept reference (Phase 3.2)",
    "",
    `These are the ONLY valid \`canonical_id\` values for this evaluation frame.`,
    "",
    `- Snapshot id \`${catalog.snapshotId}\`; hash \`${catalog.snapshotHash}\``,
    `- Manifest version ${catalog.manifestVersion}; catalog schema ${catalog.schemaVersion}`,
    `- Concepts ${catalog.concepts.length} across ${byFamily.size} families`,
    "",
    "The reference is derived from the frozen snapshot's rule set, not from the live registry.",
    "To report a meaningful concept that is missing here, use `verdict=registry_gap` and describe",
    "it in `note`; do not guess an id. See `docs/semantic-review-protocol.md`.",
    "",
  ];
  for (const family of [...byFamily.keys()].sort((a, b) => a.localeCompare(b))) {
    lines.push(`## ${family}`, "");
    for (const c of byFamily.get(family)!) {
      const desc = c.description.length > 0 ? ` — ${c.description}` : "";
      lines.push(`- \`${c.id}\` — ${c.label}${desc}`);
      if (c.aliases.length > 0) lines.push(`  - Also matched here: ${c.aliases.join(", ")}`);
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

/** Filterable/spreadsheet-friendly form of the same deterministic catalog. */
export function renderConceptCatalogCsv(catalog: CanonicalConceptCatalog): string {
  const cell = (s: string): string => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const rows = [
    ["canonical_id", "label", "family", "description", "aliases"],
    ...catalog.concepts.map((c) => [c.id, c.label, c.family, c.description, c.aliases.join(";")]),
  ];
  return `${rows.map((r) => r.map(cell).join(",")).join("\n")}\n`;
}
