const PROVIDER_KINDS: [RegExp, string][] = [
  [/timeout/i, "timeout"],
  [/429|rate[\s-]?limit/i, "rate limit"],
  [/401|403|\bauth\b|api key|unauthorized/i, "auth"],
  [/402|\bcredits?\b|quota|insufficient/i, "credits"],
  [/\b(425|500|502|503|504)\b|unavailable/i, "unavailable"],
  [/\b400\b|bad request/i, "bad request"],
  [/\b404\b|not found/i, "not found"],
  [/typeerror|\bnetwork\b|fetch failed|econn/i, "network"],
  [/invalid provider response|unexpected token|syntaxerror/i, "invalid response"],
];

/** A stable label for a provider failure, including older messages already stored on a dispatch. */
export function providerErrorKind(message: string): string | null {
  for (const [pattern, kind] of PROVIDER_KINDS) {
    if (pattern.test(message)) return kind;
  }
  return null;
}

/**
 * Provider-level failure kinds that will also fail every remaining document in the batch:
 * the run stops and the cooldown backoff takes over. Any other failure (a parse bug, an
 * unexpected extraction shape, a timeout on one oversized post) says nothing about the next
 * document, so the batch continues and only that document is retried.
 */
export const PROVIDER_OUTAGE_KINDS = new Set(["rate limit", "credits", "auth", "unavailable"]);

/** Short line for the status strip, activity log, and dispatch row. Status codes are kept. */
export function formatProviderError(message: string): string {
  const kind = providerErrorKind(message);
  if (!kind) return message.replace(/\s+/g, " ").trim().slice(0, 120);
  const status = message.match(/\b(400|401|402|403|404|408|425|429|500|502|503|504)\b/);
  return status ? `Provider ${kind} (${status[1]})` : `Provider ${kind}`;
}

const COOLDOWN_BASE_MS = 5 * 60_000;
export const COOLDOWN_MAX_MS = 60 * 60_000;

/** Backoff after a run stopped on a provider-level outage (rate limit, credits, auth, provider down). */
export interface Cooldown {
  /** Consecutive stopped runs, so each repeat waits twice as long. */
  level: number;
  until: string;
}

/** The cooldown to store after another rate-limited run: 5 min, doubling, capped at an hour. */
export function nextCooldown(previous: Cooldown | null, now = Date.now()): Cooldown {
  const level = previous?.level ?? 0;
  const ms = Math.min(COOLDOWN_MAX_MS, COOLDOWN_BASE_MS * 2 ** level);
  return { level: level + 1, until: new Date(now + ms).toISOString() };
}
