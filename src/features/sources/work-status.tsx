import type { WorkProgress } from "@/shared/infra/ingest/auto-ingest";
import { formatWork, isLive, isStalled } from "./sources-work";

export function WorkStatus({
  local,
  remote,
  pending,
  stopped,
}: {
  local: WorkProgress | null;
  remote: WorkProgress | null;
  pending: number;
  stopped: string | null;
}) {
  const lines: { key: string; text: string; tone: "live" | "stalled" | "idle" }[] = [];
  if (local && local.phase !== "done")
    lines.push({ key: "local", text: formatWork(local), tone: "live" });
  if (isLive(remote))
    lines.push({ key: "remote", text: `Auto-sync · ${formatWork(remote)}`, tone: "live" });
  else if (isStalled(remote))
    lines.push({
      key: "remote",
      text: `Auto-sync stalled · ${formatWork(remote)}`,
      tone: "stalled",
    });
  if (lines.length === 0)
    lines.push(
      stopped
        ? {
            key: "stopped",
            text: `Stopped · ${stopped} · ${pending} waiting`,
            tone: "stalled",
          }
        : { key: "idle", text: `Idle · ${pending} waiting`, tone: "idle" },
    );
  const toneClass = {
    live: "text-primary",
    stalled: "text-destructive",
    idle: "text-muted-foreground",
  } as const;
  return (
    <div className="mb-3 space-y-1 font-mono text-xs">
      {lines.map((line) => (
        <p key={line.key} className={toneClass[line.tone]}>
          {line.text}
        </p>
      ))}
    </div>
  );
}
