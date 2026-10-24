/**
 * Next time a five-field cron expression fires. Supports what the schedule uses - `*`, `*\/n`,
 * single values, `a-b` and comma lists - read in UTC, the container's clock. Pure.
 */
function field(spec: string, min: number, max: number): Set<number> {
  const out = new Set<number>();
  for (const part of spec.split(",")) {
    const [range, stepText] = part.split("/");
    const step = stepText ? Number(stepText) : 1;
    let lo = min;
    let hi = max;
    if (range && range !== "*") {
      const [a, b] = range.split("-").map(Number);
      lo = a!;
      hi = b ?? (stepText ? max : a!);
    }
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

export function nextCronRun(cron: string, after: Date): Date | undefined {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return undefined;
  const [mi, h, dom, mon, dow] = [
    field(parts[0]!, 0, 59),
    field(parts[1]!, 0, 23),
    field(parts[2]!, 1, 31),
    field(parts[3]!, 1, 12),
    field(parts[4]!, 0, 6),
  ];
  const t = new Date(after.getTime());
  t.setUTCSeconds(0, 0);
  // Two days of minutes covers every schedule in use (the sparsest is daily).
  for (let i = 0; i < 2 * 24 * 60 + 1; i++) {
    t.setUTCMinutes(t.getUTCMinutes() + 1);
    if (
      mi.has(t.getUTCMinutes()) &&
      h.has(t.getUTCHours()) &&
      dom.has(t.getUTCDate()) &&
      mon.has(t.getUTCMonth() + 1) &&
      dow.has(t.getUTCDay())
    )
      return new Date(t.getTime());
  }
  return undefined;
}
