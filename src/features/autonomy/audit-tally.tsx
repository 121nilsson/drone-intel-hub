import { pctPrecise } from "@/shared/ui/format";
import { Stat } from "./stat";

export function Tally({
  label,
  t,
}: {
  label: string;
  t: { answered: number; errors: number; cannotTell: number; upperBound: number };
}) {
  return (
    <Stat
      label={label}
      value={`${t.errors} / ${t.answered}`}
      hint={`errors · error rate ≤ ${t.answered ? pctPrecise(t.upperBound) : "—"} · ${t.cannotTell} can't tell`}
    />
  );
}
