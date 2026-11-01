import { createServerFn } from "@tanstack/react-start";
import type { AutonomyEvent, VerificationRunRecord } from "@/shared/contracts/verification";
import { listAutonomyEvents, recordAutonomyEvent } from "./ledger.server";

/**
 * Browser bridge to the autonomy ledger. The verification itself runs against whichever store the
 * catalogue is attached to (browser or server), so these functions only read and append the
 * decision log - never the catalogue.
 */

const count = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
};

/** Accept only the counts a run reports; anything else is a caller bug, not data. */
const checkRun = (d: unknown): VerificationRunRecord => {
  if (!d || typeof d !== "object") throw new Error("Invalid verification summary");
  const s = d as Record<string, unknown>;
  return {
    at: typeof s["at"] === "string" ? s["at"].slice(0, 40) : new Date().toISOString(),
    verifierVersion:
      typeof s["verifierVersion"] === "string" ? s["verifierVersion"].slice(0, 40) : "unknown",
    checked: count(s["checked"]),
    changed: count(s["changed"]),
    missingText: count(s["missingText"]),
    verified: count(s["verified"]),
    uncertain: count(s["uncertain"]),
    rejected: count(s["rejected"]),
    unverified: count(s["unverified"]),
  };
};

export const fetchAutonomyEvents = createServerFn({ method: "GET" }).handler(
  async (): Promise<AutonomyEvent[]> => await listAutonomyEvents(),
);

export const recordVerificationRun = createServerFn({ method: "POST" })
  .validator(checkRun)
  .handler(async ({ data }) => {
    const { verified, uncertain, rejected, unverified } = data;
    await recordAutonomyEvent({
      action: "verification_run",
      actor: `verifier:${data.verifierVersion}`,
      actorKind: "verifier",
      targetCollection: "drones",
      targetId: "catalogue",
      verdict: data.missingText > 0 ? "partial" : "complete",
      after: { verified, uncertain, rejected, unverified },
      reason:
        `${data.checked} claim(s) checked, ${data.changed} entry(ies) updated, ` +
        `${data.missingText} without source text`,
      // A run changes nothing by itself; the claims it re-verified carry their own verdicts.
      reversible: false,
    });
    return { ok: true };
  });
