import { useNavigate } from "@tanstack/react-router";
import { consensus } from "@/entities/drone/consensus";
import { intersectBands, linkIsFiber } from "@/entities/normalization/rf";
import { flag, type Drone } from "@/entities/drone/types";
import { useDrones } from "@/shared/infra/services";
import { Panel, Tag } from "@/shared/ui/primitives";

function overlap(a: Drone, b: Drone) {
  const shared: string[] = [];
  for (const x of a.rf)
    for (const y of b.rf) {
      if (linkIsFiber(x) || linkIsFiber(y)) continue;
      const hit = x.freqMHz && y.freqMHz ? intersectBands(x.freqMHz, y.freqMHz) : undefined;
      if (hit) shared.push(`${x.role}/${y.role} · ${hit[0]}–${hit[1]} MHz`);
      else if (!x.freqMHz && !y.freqMHz && x.band === y.band) shared.push(`${x.role}/${y.role} · ${x.band}`);
    }
  return [...new Set(shared)];
}

export function CounterpartsPage({ a, b }: { a?: string | undefined; b?: string | undefined }) {
  const drones = useDrones();
  const nav = useNavigate();
  // Comparison is meaningless with fewer than two systems.
  if (drones.length < 2)
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-semibold">Counterpart comparison</h1>
        <p className="text-sm text-muted-foreground">
          Needs at least two catalogued systems to compare. Add or promote a system first.
        </p>
      </div>
    );
  const A = drones.find((d) => d.id === a) ?? drones[0];
  if (!A) return null;
  // Must exclude A, or the "no b in the URL" case can resolve to the same system twice.
  const B =
    drones.find((d) => d.id === b && d.id !== A.id) ??
    drones.find((d) => d.id !== A.id && A.counterpartIds.includes(d.id)) ??
    drones.find((d) => d.id !== A.id);
  if (!B) return null;
  const keys = [...new Set([...A.specs, ...B.specs].map((s) => s.key))];
  const shared = overlap(A, B);
  const fiberLinked = [A, B].filter((d) => d.rf.some((r) => linkIsFiber(r)));
  const set = (k: "a" | "b", v: string) =>
    nav({ to: "/counterparts", search: { a: k === "a" ? v : A.id, b: k === "b" ? v : B.id } });

  const Card = ({ d, k }: { d: Drone; k: "a" | "b" }) => (
    <Panel
      title={
        <select
          value={d.id}
          onChange={(e) => set(k, e.target.value)}
          className="bg-transparent font-mono text-xs uppercase outline-none"
        >
          {drones
            .filter((x) => x.id !== (k === "a" ? B.id : A.id))
            .map((x) => (
              <option key={x.id} value={x.id} className="bg-card">
                {x.name}
              </option>
            ))}
        </select>
      }
    >
      <h2 className="text-2xl font-semibold">{d.name}</h2>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Tag tone="primary">{d.domain}</Tag>
        <Tag>{flag(d.origin)}</Tag>
        {d.operators.map((o) => (
          <Tag key={o} tone="accent">
            Op {flag(o)}
          </Tag>
        ))}
      </div>
      <ul className="mt-4 space-y-1 text-sm">
        {d.rf.map((r, i) => (
          <li key={i} className="font-mono">
            <span className="text-muted-foreground">{r.role}</span> {r.band}
          </li>
        ))}
      </ul>
    </Panel>
  );

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold">Counterpart comparison</h1>
      <div className="grid gap-4 md:grid-cols-2">
        <Card d={A} k="a" />
        <Card d={B} k="b" />
      </div>
      <Panel title="Potential frequency overlap">
        {shared.length ? (
          <ul className="flex flex-wrap gap-2">
            {shared.map((s) => (
              <Tag key={s} tone="danger">
                {s}
              </Tag>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No overlapping frequencies in the recorded links.</p>
        )}
        {fiberLinked.length > 0 && (
          <p className="mt-3 text-sm text-accent">
            {fiberLinked.map((d) => d.name).join(", ")} {fiberLinked.length > 1 ? "use" : "uses"} a fiber-optic link, so that link has no radio frequency to compare.
          </p>
        )}
      </Panel>
      <Panel title="Specification delta">
        <table className="w-full text-sm">
          <thead>
            <tr className="font-mono text-[11px] uppercase text-muted-foreground">
              <th className="pb-2 text-left">Attribute</th>
              <th className="pb-2 text-right">{A.name}</th>
              <th className="pb-2 text-right">{B.name}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {keys.map((k) => {
              const sa = A.specs.find((s) => s.key === k),
                sb = B.specs.find((s) => s.key === k);
              return (
                <tr key={k}>
                  <td className="py-2">{(sa ?? sb)!.label}</td>
                  {[sa, sb].map((s, i) => {
                    const c = s ? consensus(s) : null;
                    return (
                      <td key={i} className="py-2 text-right font-mono">
                        {c ? c.display : "—"}
                        {c?.disputed && <Tag tone="danger" className="ml-1">Disputed</Tag>}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
