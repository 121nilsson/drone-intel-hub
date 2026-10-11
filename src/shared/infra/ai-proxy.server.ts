/**
 * OpenAI-compatible chat transport.
 *
 * This is a plain function, not a server function, so it can be called from the Nitro task
 * runner as well as from a request. Server functions need a Start request context
 * (AsyncLocalStorage), which does not exist on a cron tick - calling one from a scheduled
 * task fails with "No Start context found in AsyncLocalStorage".
 *
 * Supports multi-provider fallback: if one provider fails or times out, automatically
 * tries the next available provider.
 */

import {
  getProvider,
  getProviderApiKey,
  getProviderBaseUrl,
  getProviderModel,
  getAvailableProviders,
  isMultiProviderEnabled,
  type AIProvider,
} from "./ai-providers";
import { parseModelJson } from "./model-json";

export interface ChatInput {
  baseUrl?: string;
  apiKey?: string;
  model: string;
  system: string;
  prompt: string;
  json: boolean;
  /** Optional: specific provider to use (otherwise uses multi-provider fallback) */
  provider?: string;
  /**
   * Which tier this call belongs to, used to pick each provider's model along a fallback chain.
   *
   * It selects a MODEL, not a ROUTE. Provider order is always priority order, deliberately: the
   * tier routes in ai-providers.ts were written when tier 1 was expected to be served by Groq,
   * and honouring them would silently move tier-1 extraction off the model an operator has
   * configured in NVIDIA_TIER1_MODEL. The routes stay readable configuration; nothing consults
   * them for ordering yet.
   */
  tier?: "tier1" | "tier2";
}

export type ChatResult =
  | { ok: true; content: string; provider?: string }
  | {
      ok: false;
      error: string;
      provider?: string;
      /**
       * True when every provider failed for availability reasons (rate limit, credits, auth,
       * provider down, or cooling down after one of those) - retrying later can succeed, and the
       * document is not at fault. False for a timeout, a rejected request or an unusable reply.
       */
      outage?: boolean;
    };

/** Injectable transport so callers choose the RPC bridge (browser) or direct (server task). */
export type ChatTransport = (input: ChatInput) => Promise<ChatResult>;

const env = (k: string) => {
  const v = process.env[k]?.trim();
  return v ? v : undefined;
};

/**
 * Request pacing.
 *
 * A provider caps requests per minute per key, and the counter is per key rather than per
 * caller - a cron tick, a manual sync and a browser tab all draw on the same budget. So the
 * spacing lives here, in the one function every caller shares: each call reserves its start
 * slot at least `60s / rpm` after the previous reservation *for the same provider*, which caps
 * the aggregate rate per key no matter how many callers are in flight. Providers do not share a
 * budget, so one being throttled never slows another. `${NAME}_RPM` overrides PROVIDER_RPM for one
 * provider; 0 disables pacing (a self-hosted vLLM has no such cap).
 */
const rpm = Number(env("PROVIDER_RPM") ?? 35);
const MIN_SPACING_MS = Number.isFinite(rpm) && rpm > 0 ? Math.ceil(60_000 / rpm) : 0;

/** Requests per minute the pacer allows per provider, or 0 when pacing is disabled. */
export const providerRpm = () => (MIN_SPACING_MS ? rpm : 0);

function spacingFor(provider: string): number {
  const own = env(`${provider.toUpperCase()}_RPM`);
  if (own === undefined) return MIN_SPACING_MS;
  const n = Number(own);
  return Number.isFinite(n) && n > 0 ? Math.ceil(60_000 / n) : 0;
}

interface ProviderState {
  /** The earliest time the next call may start. Monotonic via Date.now() under fake timers. */
  nextSlot: number;
  /**
   * Set by a 429. The limit is per key, so once one caller is told to back off every other
   * caller sharing the key would be refused too - they all wait, not just the one that got the
   * 429. Applies even with pacing off, since a Retry-After is the provider's own word.
   */
  pausedUntil: number;
}

const providerState = new Map<string, ProviderState>();

function stateFor(provider: string): ProviderState {
  let s = providerState.get(provider);
  if (!s) {
    s = { nextSlot: 0, pausedUntil: 0 };
    providerState.set(provider, s);
  }
  return s;
}

/**
 * Set when a provider gives up for availability reasons. A fallback chain skips it until then
 * instead of paying for the same refusal on every document.
 *
 * Keyed by provider for failures of the account (rejected key, no credits, provider down) and by
 * provider + model for failures of one model (a 429, repeated timeouts). Groq's limits are per
 * model, and a slow tier-2 model says nothing about the tier-1 model on the same key - parking
 * the whole provider would throw away budget that is still there.
 */
const cooldowns = new Map<string, { until: number; reason: string }>();
const modelKey = (provider: string, model: string) => `${provider}:${model}`;

/** Consecutive timeouts per provider + model; any HTTP response resets the count. */
const consecutiveTimeouts = new Map<string, number>();
/** Two timeouts in a row means the model is overloaded, not that one post was too long. */
const TIMEOUTS_BEFORE_COOLDOWN = 2;
const TIMEOUT_COOLDOWN_MS = 5 * 60_000;

/** Forget pacing and cooldowns. For tests; a process restart does the same. */
export function resetProviderState() {
  providerState.clear();
  cooldowns.clear();
  consecutiveTimeouts.clear();
}

/** Reserve this caller's start slot on `provider` and wait for it. */
function pace(provider: string): Promise<void> {
  const s = stateFor(provider);
  const spacing = spacingFor(provider);
  const now = Date.now();
  let turn = Math.max(now, s.pausedUntil);
  if (spacing) {
    // Anchoring on `turn` keeps a burst from walking `nextSlot` arbitrarily far ahead.
    turn = Math.max(turn, s.nextSlot);
    s.nextSlot = turn + spacing;
  }
  const delay = turn - now;
  return delay > 0 ? new Promise((r) => setTimeout(r, delay)) : Promise.resolve();
}

/** The cooldown still running for this provider or this model on it, whichever ends later. */
function cooling(provider: string, model: string): { ms: number; reason: string } | undefined {
  let found: { ms: number; reason: string } | undefined;
  for (const key of [provider, modelKey(provider, model)]) {
    const c = cooldowns.get(key);
    const ms = c ? c.until - Date.now() : 0;
    if (c && ms > 0 && (!found || ms > found.ms)) found = { ms, reason: c.reason };
  }
  return found;
}

/**
 * How long, and at what scope, a provider sits out after giving up with `status`. Undefined: not
 * an availability failure.
 */
const MAX_COOLDOWN_MS = 60 * 60_000;
function cooldownFor(
  status: number,
  retryAfter?: number,
): { ms: number; scope: "model" | "provider" } | undefined {
  // Uncapped by MAX_BACKOFF_MS on purpose: a daily-quota 429 can say "come back in hours", and
  // honouring it is what stops the chain from re-asking on every document.
  if (status === 429)
    return { ms: Math.min(MAX_COOLDOWN_MS, Math.max(60_000, retryAfter ?? 0)), scope: "model" };
  if (status === 401 || status === 402 || status === 403)
    return { ms: 15 * 60_000, scope: "provider" };
  if (status === 425 || status === 500 || status === 502 || status === 503 || status === 504)
    return { ms: 30_000, scope: "provider" };
  return undefined;
}

function coolDown(key: string, ms: number, reason: string) {
  const until = Date.now() + ms;
  const prev = cooldowns.get(key);
  if (!prev || prev.until < until) cooldowns.set(key, { until, reason });
}

const ATTEMPTS = 3;
const BACKOFF_MS = 1000;
/** Ceiling for any single wait, including a Retry-After hint, so a run cannot stall for minutes. */
const MAX_BACKOFF_MS = 30_000;
/** 429 is the one that matters here; the rest are the usual transient provider failures. */
const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);

/**
 * Per-request ceiling. Without it a stalled provider connection holds its pacing slot for as
 * long as the socket lives, and the whole sequential ingest pass stalls behind it. Generous
 * because a slow reasoning model is legitimate - this exists to bound a hang, not to police
 * latency. Override with PROVIDER_TIMEOUT_MS for a self-hosted endpoint.
 */
const timeoutMs = Number(env("PROVIDER_TIMEOUT_MS") ?? 90_000);

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Collapse the status text to a short, single-line, length-capped reason. */
function reason(statusText: string) {
  return statusText.replace(/\s+/g, " ").trim().slice(0, 80);
}

/**
 * Pull a short, safe explanation out of a provider error body.
 *
 * Every OpenAI-compatible provider puts the actionable part in `error.message` - "model not
 * found", "messages must contain the word 'json'", "max tokens exceeded" - and that string is
 * the difference between a five-second fix and an afternoon of guessing. Discarding it wholesale
 * is why a failure once read only as "bad request (400)".
 *
 * It is still untrusted input: the body can echo the prompt, and a provider could reflect a
 * header back. So only `error.message` is taken (never the raw body), it is capped, and anything
 * that looks like a credential or a long opaque token is replaced before it can reach a log line
 * or the database.
 */
const MAX_DETAIL = 240;

function scrubDetail(text: string): string {
  const known = Object.values(process.env)
    .filter((v): v is string => typeof v === "string" && v.length >= 20)
    .map((v) => v.trim());
  let out = text;
  for (const secret of known) out = out.split(secret).join("[redacted]");
  return (
    out
      // Authorization headers and the common vendor key shapes. The trailing hyphen is written
      // last in the class so it is a literal rather than a range.
      .replace(/\b(?:Bearer|Basic)\s+[\w.-]+/gi, "[redacted]")
      .replace(/\b(?:sk|gsk|xai|nvapi|api|key)[-_][A-Za-z0-9_-]{12,}/g, "[redacted]")
      // Any other long opaque run, which is what a leaked token looks like.
      .replace(/\b[A-Za-z0-9_-]{32,}\b/g, "[redacted]")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_DETAIL)
  );
}

/** The provider's own explanation, or "" when there isn't a usable one. */
function detailFrom(body: string): string {
  if (!body || body.length > 20_000) return "";
  try {
    const j = JSON.parse(body) as { error?: { message?: unknown }; message?: unknown };
    const msg = j.error?.message ?? j.message;
    return typeof msg === "string" && msg.trim() ? scrubDetail(msg) : "";
  } catch {
    // Not JSON. Providers sometimes return plain text; take it if it is short and printable.
    const t = body.trim();
    if (!t || t.length > 400 || /[<>{}]/.test(t)) return "";
    return scrubDetail(t);
  }
}

/**
 * What an operator should check first for a status.
 *
 * Deliberately phrased as "usually" rather than as a diagnosis - the same status has different
 * causes per provider, and this is a pointer to where to look, not a claim about what happened.
 */
function failureHint(status: number): string {
  if (status === 400)
    return "usually the model id is not on this provider, or the request shape is unsupported (json mode needs 'json' in the messages)";
  if (status === 404) return "usually the model or the endpoint path is wrong for this provider";
  if (status === 401 || status === 403)
    return "the key was rejected - check it is current and enabled for this provider";
  if (status === 402) return "no credits left on this provider's account";
  if (status === 408) return "the provider took too long to answer";
  if (status === 413) return "the prompt is larger than this provider accepts";
  if (status === 429) return "this provider's rate limit for the key";
  if (status >= 500) return "the provider failed on its side; usually worth retrying";
  return "";
}

/** A one-line description of an attempt, for logs. Contains no credentials. */
function attemptLabel(provider: string, baseUrl: string, model: string, tier?: string): string {
  let host = baseUrl;
  try {
    host = new URL(baseUrl).host;
  } catch {
    /* keep the raw string */
  }
  return `${provider} @ ${host} model=${model}${tier ? ` tier=${tier}` : ""}`;
}

/** A short kind the Sources page can show. The URL and body stay out of the string. */
function transportError(e: unknown): string {
  const name = e instanceof Error ? e.name : "";
  if (name === "TimeoutError" || name === "AbortError") return "Provider timeout";
  if (name === "TypeError") return "Provider network";
  return name ? `Provider network (${name})` : "Provider network";
}

function statusError(status: number, statusText: string): string {
  const detail = reason(statusText);
  const kind =
    status === 429
      ? "rate limit"
      : status === 408
        ? "timeout"
        : status === 401 || status === 403
          ? "auth"
          : status === 402
            ? "credits"
            : status === 400
              ? "bad request"
              : status === 404
                ? "not found"
                : status === 425 ||
                    status === 500 ||
                    status === 502 ||
                    status === 503 ||
                    status === 504
                  ? "unavailable"
                  : null;
  if (!kind) return detail ? `Provider ${status}: ${detail}` : `Provider ${status}`;
  return detail ? `Provider ${kind} (${status}: ${detail})` : `Provider ${kind} (${status})`;
}

/** Retry-After is either delta-seconds or an HTTP date; either way it beats our own guess. */
function retryAfterMs(res: Response): number | undefined {
  const h = res.headers.get("retry-after");
  if (!h) return undefined;
  const secs = Number(h);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const at = Date.parse(h);
  return Number.isNaN(at) ? undefined : Math.max(0, at - Date.now());
}

/** Exponential backoff with full jitter, so concurrent callers don't resynchronise into a
 *  thundering herd. A Retry-After hint is a floor, never shortened by the jitter. */
function backoffMs(attempt: number, retryAfter?: number): number {
  const own = Math.min(MAX_BACKOFF_MS, BACKOFF_MS * 2 ** attempt) * (0.5 + Math.random() / 2);
  return Math.min(MAX_BACKOFF_MS, Math.max(own, retryAfter ?? 0));
}

/** Talks to any OpenAI-compatible endpoint. Credentials fall back to the environment so a
 *  key in .env.local never has to reach the browser.
 *
 *  Rate-limit and transient server responses are retried internally with backoff rather than
 *  surfacing as a failed extraction: a 429 on one post should cost a second, not abandon the
 *  rest of the source. The body is built once and reused - a string body is safe to replay.
 *
 *  When more than one provider has a key, a failure falls through to the next one (see
 *  callWithProviders). A provider cooling down after a quota, credit, auth or outage failure is
 *  skipped until its cooldown ends.
 */
export async function chatCompletionOnce(d: ChatInput): Promise<ChatResult> {
  const specificProvider = d.provider ? getProvider(d.provider) : undefined;

  // A pinned provider is used alone: the caller asked for that one.
  if (specificProvider) return callSingleProvider(d, specificProvider);

  if (isMultiProviderEnabled()) return callWithProviders(d, getAvailableProviders());

  // Single provider mode (backward compatible)
  return callSingleProvider(d);
}

/** Statuses that say "this provider cannot serve anyone right now", not "this request is bad". */
const OUTAGE_STATUS = new Set([401, 402, 403, 425, 429, 500, 502, 503, 504]);

/** The short kind used in a cooldown message; matches statusError's wording. */
function providerKindLabel(status: number): string {
  if (status === 429) return "rate limit";
  if (status === 402) return "credits";
  if (status === 401 || status === 403) return "auth";
  return "unavailable";
}

/**
 * Call a single provider with the given input.
 *
 * With no provider named, this resolves to the FIRST AVAILABLE one rather than to a hardcoded
 * NVIDIA entry. The hardcoded version only ever consulted NVIDIA_API_KEY, so a deployment
 * configured with, say, just GROQ_API_KEY passed the multi-provider check (one provider, so not
 * multi-provider) and then failed with "No API key" - the fallback work being pointless in
 * exactly the configuration that needs it most. Order still comes from priority.
 *
 * `fallThrough` is set when another provider can take the call: a 429 or a timeout then gives up
 * after one attempt, because the next provider is a better use of the wait than this one's retry.
 */
async function callSingleProvider(
  d: ChatInput,
  provider?: AIProvider,
  opts: { fallThrough?: boolean } = {},
): Promise<ChatResult> {
  const actualProvider =
    provider ??
    getAvailableProviders()[0] ??
    // Nothing is configured. Fall back to the NVIDIA entry so the error below names the variable
    // an operator needs to set, rather than failing on an undefined lookup.
    getProvider("nvidia")!;
  const name = actualProvider.name;

  const callerKey = d.apiKey?.trim();
  const apiKey = callerKey || getProviderApiKey(actualProvider);
  // The caller's base URL is honoured only together with the caller's own key. Otherwise any
  // client of the chatCompletion server function could name a host and receive the server's key
  // in the Authorization header.
  const baseUrl = ((callerKey && d.baseUrl?.trim()) || getProviderBaseUrl(actualProvider)).replace(
    /\/$/,
    "",
  );

  if (!apiKey)
    throw new Error(
      `No API key: set ${actualProvider.apiKeyEnv} in .env.local or save one in Settings`,
    );
  if (!baseUrl.startsWith("https://")) throw new Error("Base URL must be https");

  const label = attemptLabel(name, baseUrl, d.model, d.tier);
  const parked = cooling(name, d.model);
  if (parked) {
    return {
      ok: false,
      error: `Provider ${parked.reason} — cooling down ${Math.ceil(parked.ms / 1000)}s`,
      provider: name,
      outage: true,
    };
  }
  const mk = modelKey(name, d.model);

  const body = JSON.stringify({
    model: d.model,
    messages: [
      { role: "system", content: d.system },
      { role: "user", content: d.prompt },
    ],
    ...(d.json ? { response_format: { type: "json_object" } } : {}),
  });

  /** A reply that arrived but cannot be used. Not retried here: the next provider may do better. */
  const unusable = (error: string): ChatResult => {
    console.warn(`[ai-proxy] unusable reply — ${label} — ${error}`);
    return { ok: false, error, provider: name, outage: false };
  };

  let error = "Provider request failed";
  /** What actually happened on the last attempt, for the log line. See attemptLabel. */
  let lastFailure = "no attempt made";
  // Wait owed by the *previous* attempt, so the pacing and backoff costs are paid once.
  let owed = 0;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    if (owed) await sleep(owed);
    await pace(name);

    let res: Response;
    try {
      res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body,
        ...(Number.isFinite(timeoutMs) && timeoutMs > 0
          ? { signal: AbortSignal.timeout(timeoutMs) }
          : {}),
      });
    } catch (e) {
      // Transport-level failure (DNS, TLS, socket reset, timeout) is worth another try - unless
      // another provider is waiting, in which case a 90-second timeout is not worth repeating.
      // The error message can echo the URL, so it is not surfaced verbatim.
      error = transportError(e);
      lastFailure = `transport: ${error}`;
      if (error === "Provider timeout") {
        const streak = (consecutiveTimeouts.get(mk) ?? 0) + 1;
        consecutiveTimeouts.set(mk, streak);
        if (streak >= TIMEOUTS_BEFORE_COOLDOWN) {
          // An overloaded model times out on every post; without this each one waits the full
          // timeout before the chain moves on.
          consecutiveTimeouts.delete(mk);
          coolDown(mk, TIMEOUT_COOLDOWN_MS, "timeout");
          lastFailure += ` — ${streak} in a row, cooling down ${TIMEOUT_COOLDOWN_MS / 1000}s`;
          break;
        }
        if (opts.fallThrough) break;
      }
      owed = backoffMs(attempt);
      continue;
    }
    // Any answer, even an error status, means the model is responding.
    consecutiveTimeouts.delete(mk);

    // Read once: the body is needed for the success path, and the error path deliberately
    // ignores it (see below).
    const text = await res.text();
    if (res.ok) {
      type Message = { content?: string | null; reasoning_content?: string | null };
      let msg: Message | undefined;
      try {
        msg = (JSON.parse(text) as { choices?: { message?: Message }[] }).choices?.[0]?.message;
      } catch {
        return unusable("Invalid provider response");
      }
      const content = msg?.content ?? "";
      if (d.json) {
        // A 200 with no recoverable JSON object is a failure, so the chain moves on rather than
        // handing the extractor something it can only throw on. Reasoning models sometimes leave
        // `content` empty and put the answer at the end of `reasoning_content`.
        const parsed =
          parseModelJson(content) ??
          (content.trim() ? undefined : parseModelJson(msg?.reasoning_content ?? ""));
        if (!parsed) return unusable("Invalid provider response (no JSON object)");
        return { ok: true, content: JSON.stringify(parsed) };
      }
      const out = content.trim() ? content : (msg?.reasoning_content ?? "");
      if (!out.trim()) return unusable("Invalid provider response (empty)");
      return { ok: true, content: out };
    }

    // The provider's own explanation is the part that says WHY, so it is kept - but only
    // `error.message`, only scrubbed, and only length-capped (see scrubDetail). Without it a
    // chain failure reads as "bad request (400)" and tells the operator nothing.
    const said = detailFrom(text);
    error = statusError(res.status, res.statusText);
    const hint = failureHint(res.status);
    lastFailure = `HTTP ${res.status}${said ? `: ${said}` : ""}${hint ? ` (${hint})` : ""}`;
    const retryAfter = retryAfterMs(res);
    const giveUp =
      !RETRYABLE.has(res.status) ||
      attempt === ATTEMPTS - 1 ||
      (opts.fallThrough === true && res.status === 429);
    // One line per provider, when it finally gives up - not per attempt, which would bury the
    // signal under retry noise.
    if (giveUp) {
      const cool = cooldownFor(res.status, retryAfter);
      if (cool)
        coolDown(cool.scope === "model" ? mk : name, cool.ms, providerKindLabel(res.status));
      console.warn(
        `[ai-proxy] gave up after ${attempt + 1}/${ATTEMPTS} attempt(s) — ${label} — ${lastFailure}${
          cool
            ? ` — cooling down ${cool.scope === "model" ? "this model" : "this provider"} ${Math.ceil(cool.ms / 1000)}s`
            : ""
        }`,
      );
      return { ok: false as const, error, provider: name, outage: OUTAGE_STATUS.has(res.status) };
    }
    const wait = backoffMs(attempt, retryAfter);
    if (res.status === 429) {
      // Paid through the provider's shared pause, which this caller's own pace() also honours.
      const s = stateFor(name);
      s.pausedUntil = Math.max(s.pausedUntil, Date.now() + wait);
      owed = 0;
    } else {
      owed = wait;
    }
  }
  console.warn(`[ai-proxy] gave up — ${label} — ${lastFailure}`);
  return { ok: false as const, error, provider: name, outage: false };
}

/**
 * Try providers in order until one succeeds.
 *
 * Model selection is per provider, and the highest-priority one is deliberately special: it gets
 * `d.model`, the model the operator actually configured for this tier. Every other provider is
 * asked for its own model - because a model id belongs to one provider's catalogue, and replaying
 * `nvidia/nemotron-3-super-120b-a12b` against Groq is a request guaranteed to fail, which would
 * turn one provider outage into three more doomed ones.
 *
 * So a fallback is a real second attempt, resolved by `getProviderModel(provider, d.tier)`:
 * the provider's tier-specific model if it declares one, else its `defaultModel`.
 *
 * Providers cooling down are skipped without a request. The result is an outage only when every
 * provider failed for availability reasons; one that rejected the request or returned an unusable
 * reply makes it a document-level failure, so a queue does not stall behind a post no provider
 * can handle.
 */
async function callWithProviders(d: ChatInput, providers: AIProvider[]): Promise<ChatResult> {
  if (providers.length === 0) return { ok: false, error: "No AI providers configured" };

  const used: string[] = [];
  const skipped: string[] = [];
  let lastError = "All providers failed";
  let allOutage = true;

  // The configured model belongs to the highest-priority provider; every other provider is asked
  // for its own model for this tier. Resolved once, so the cooldown check and the call agree.
  const modelFor = (p: AIProvider) =>
    p === providers[0] ? d.model || getProviderModel(p, d.tier) : getProviderModel(p, d.tier);
  const ready = providers.filter((p) => {
    const parked = cooling(p.name, modelFor(p));
    if (parked)
      skipped.push(`${p.name}:${modelFor(p)} (${parked.reason}, ${Math.ceil(parked.ms / 1000)}s)`);
    return !parked;
  });
  const coolingNote = skipped.length ? ` Cooling down: ${skipped.join(", ")}.` : "";
  if (!ready.length) {
    return {
      ok: false,
      error: `All providers unavailable.${coolingNote}`,
      provider: providers.map((p) => p.name).join(", "),
      outage: true,
    };
  }

  for (const [index, provider] of ready.entries()) {
    const apiKey = getProviderApiKey(provider);
    const providerInput: ChatInput = {
      ...d,
      baseUrl: getProviderBaseUrl(provider),
      ...(apiKey ? { apiKey } : {}),
      model: modelFor(provider),
    };
    used.push(`${provider.name}:${providerInput.model}`);
    const hasNext = index < ready.length - 1;

    try {
      const result = await callSingleProvider(providerInput, provider, { fallThrough: hasNext });
      if (result.ok) return { ...result, provider: provider.name };
      lastError = result.error;
      if (!result.outage) allOutage = false;
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : "Unknown error";
      lastError = errorMsg;
      allOutage = false;
      // callSingleProvider logs its own give-up line; this only covers a throw it could not.
      console.warn(
        `[ai-proxy] threw — ${attemptLabel(provider.name, getProviderBaseUrl(provider), providerInput.model, d.tier)} — ${errorMsg}`,
      );
    }
    // The chain moving on is the interesting moment: which provider, which model, and that the
    // previous one failed. Without this, a log shows isolated failures with no indication that a
    // different model was tried next.
    if (hasNext) {
      const next = ready[index + 1]!;
      console.warn(
        `[ai-proxy] falling through — ${provider.name} failed (${lastError}) — next: ${next.name} with its own ${d.tier ?? "tier"} model (${getProviderModel(next, d.tier)})`,
      );
    }
  }

  return {
    ok: false,
    // The models are named because "Groq: nvidia/nemotron..." is the diagnostic that tells an
    // operator the chain is wired wrong; without it a total outage is indistinguishable from a
    // misconfigured model on every provider.
    error: `All providers ${allOutage ? "unavailable" : "failed"}. Last error: ${lastError}. Tried: ${used.join(", ")}.${coolingNote}`,
    provider: ready.map((p) => p.name).join(", "),
    outage: allOutage,
  };
}
