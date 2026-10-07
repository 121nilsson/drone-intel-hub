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

/** The earliest time the next call is allowed to start. Monotonic via Date.now() under fake timers. */
let nextSlot = 0;

/** Reserve this caller's start slot and wait for it. Returns immediately when pacing is off. */
function pace(): Promise<void> {
  if (!MIN_SPACING_MS) return Promise.resolve();
  const turn = nextSlot;
  // max() keeps a burst from walking `nextSlot` arbitrarily far into the future.
  nextSlot = Math.max(nextSlot, Date.now()) + MIN_SPACING_MS;
  const delay = turn - Date.now();
  return delay > 0 ? new Promise((r) => setTimeout(r, delay)) : Promise.resolve();
}

const ATTEMPTS = 3;
const BACKOFF_MS = 1000;
/** Ceiling for any single wait, including a Retry-After hint, so a run cannot stall for minutes. */
const MAX_BACKOFF_MS = 30_000;
/** 429 is the one that matters here; the rest are the usual transient provider failures. */
const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

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
      });
    } catch (e) {
      // Transport-level failure (DNS, TLS, socket reset) is worth another try.
      error = `Provider request failed: ${e instanceof Error ? e.message : String(e)}`;
      owed = backoffMs(attempt);
      continue;
    }

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

    error = `Provider ${res.status}: ${text.slice(0, 300)}`;
    // A 400/401/404 will fail identically on every retry, so surface it immediately.
    if (!RETRYABLE.has(res.status) || attempt === ATTEMPTS - 1)
      return { ok: false as const, error };
    owed = backoffMs(attempt, retryAfterMs(res));
  }
  return { ok: false as const, error };
}
