/**
 * OpenAI-compatible chat transport.
 *
 * This is a plain function, not a server function, so it can be called from the Nitro task
 * runner as well as from a request. Server functions need a Start request context
 * (AsyncLocalStorage), which does not exist on a cron tick - calling one from a scheduled
 * task fails with "No Start context found in AsyncLocalStorage".
 */

export interface ChatInput {
  baseUrl?: string;
  apiKey?: string;
  model: string;
  system: string;
  prompt: string;
  json: boolean;
}

export type ChatResult = { ok: true; content: string } | { ok: false; error: string };

/** Injectable transport so callers choose the RPC bridge (browser) or direct (server task). */
export type ChatTransport = (input: ChatInput) => Promise<ChatResult>;

const env = (k: string) => {
  const v = process.env[k]?.trim();
  return v ? v : undefined;
};

/**
 * Request pacing.
 *
 * The provider caps requests per minute per key, and the counter is per key rather than per
 * caller - a cron tick, a manual sync and a browser tab all draw on the same budget. So the
 * spacing lives here, in the one function every caller shares: each call reserves its start
 * slot at least `MIN_SPACING_MS` after the previous reservation, which caps the *aggregate*
 * rate no matter how many callers are in flight. Set PROVIDER_RPM=0 to disable it (a
 * self-hosted vLLM has no such cap).
 */
const rpm = Number(env("PROVIDER_RPM") ?? 35);
const MIN_SPACING_MS = Number.isFinite(rpm) && rpm > 0 ? Math.ceil(60_000 / rpm) : 0;

/** Requests per minute the pacer allows, or 0 when pacing is disabled. */
export const providerRpm = () => (MIN_SPACING_MS ? rpm : 0);

/** The earliest time the next call is allowed to start. Monotonic via Date.now() under fake timers. */
let nextSlot = 0;

/**
 * Set by a 429. The provider's limit is per key, so once one caller is told to back off every
 * other caller sharing the key would be refused too - they all wait, not just the one that
 * got the 429. Applies even with pacing off, since a Retry-After is the provider's own word.
 */
let pausedUntil = 0;

function pauseAll(ms: number) {
  pausedUntil = Math.max(pausedUntil, Date.now() + ms);
}

/** Reserve this caller's start slot and wait for it. */
function pace(): Promise<void> {
  const now = Date.now();
  let turn = Math.max(now, pausedUntil);
  if (MIN_SPACING_MS) {
    // Anchoring on `turn` keeps a burst from walking `nextSlot` arbitrarily far ahead.
    turn = Math.max(turn, nextSlot);
    nextSlot = turn + MIN_SPACING_MS;
  }
  const delay = turn - now;
  return delay > 0 ? new Promise((r) => setTimeout(r, delay)) : Promise.resolve();
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
 *  rest of the source. The body is built once and reused - a string body is safe to replay. */
export async function chatCompletionOnce(d: ChatInput): Promise<ChatResult> {
  const apiKey = d.apiKey?.trim() || env("NVIDIA_API_KEY");
  const baseUrl = (d.baseUrl?.trim() || env("NVIDIA_BASE_URL") || "").replace(/\/$/, "");
  if (!apiKey)
    throw new Error("No API key: set NVIDIA_API_KEY in .env.local or save one in Settings");
  if (!baseUrl.startsWith("https://")) throw new Error("Base URL must be https");

  const body = JSON.stringify({
    model: d.model,
    messages: [
      { role: "system", content: d.system },
      { role: "user", content: d.prompt },
    ],
    ...(d.json ? { response_format: { type: "json_object" } } : {}),
  });

  let error = "Provider request failed";
  // Wait owed by the *previous* attempt, so the pacing and backoff costs are paid once.
  let owed = 0;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    if (owed) await sleep(owed);
    await pace();

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
      // Transport-level failure (DNS, TLS, socket reset, timeout) is worth another try.
      // The error message can echo the URL, so it is not surfaced verbatim.
      error = transportError(e);
      owed = backoffMs(attempt);
      continue;
    }

    // Read once: the body is needed for the success path, and the error path deliberately
    // ignores it (see below).
    const text = await res.text();
    if (res.ok) {
      try {
        const j = JSON.parse(text) as { choices?: { message?: { content?: string | null } }[] };
        // Reasoning models put the answer in `content`; some return null there with the text
        // under `reasoning_content`, so fall back rather than sending an empty prompt onward.
        const msg = j.choices?.[0]?.message;
        const content =
          msg?.content ??
          (msg as { reasoning_content?: string } | undefined)?.reasoning_content ??
          "";
        return { ok: true, content };
      } catch {
        return { ok: false as const, error: "Invalid provider response" };
      }
    }

    // Provider bodies can echo the prompt, the key, or an internal model error. They are
    // persisted into dispatch `error` fields and rendered in the UI, so keep the status and a
    // short scrubbed reason instead of up to 300 chars of upstream payload.
    error = statusError(res.status, res.statusText);
    // A 400/401/404 will fail identically on every retry, so surface it immediately.
    if (!RETRYABLE.has(res.status) || attempt === ATTEMPTS - 1)
      return { ok: false as const, error };
    const wait = backoffMs(attempt, retryAfterMs(res));
    if (res.status === 429) {
      // Paid through the shared pause, which this caller's own pace() also honours.
      pauseAll(wait);
      owed = 0;
    } else {
      owed = wait;
    }
  }
  return { ok: false as const, error };
}
