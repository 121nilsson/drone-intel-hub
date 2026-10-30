/**
 * Distinct non-empty values, most frequent first and alphabetical among equals. Facet groups show
 * only their first options until opened, so the order decides which ones the analyst sees.
 */
export function byFrequency(values: Iterable<string | undefined | null>): string[] {
  const counts = new Map<string, number>();
  for (const raw of values) {
    const v = raw?.trim();
    if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([v]) => v);
}
