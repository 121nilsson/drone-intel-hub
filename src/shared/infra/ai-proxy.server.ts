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

/** Talks to any OpenAI-compatible endpoint. Credentials fall back to the environment so a
 *  key in .env.local never has to reach the browser. */
export async function chatCompletionOnce(d: ChatInput): Promise<ChatResult> {
  const apiKey = d.apiKey?.trim() || env("NVIDIA_API_KEY");
  const baseUrl = (d.baseUrl?.trim() || env("NVIDIA_BASE_URL") || "").replace(/\/$/, "");
  if (!apiKey)
    throw new Error("No API key: set NVIDIA_API_KEY in .env.local or save one in Settings");
  if (!baseUrl.startsWith("https://")) throw new Error("Base URL must be https");

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: d.model,
      messages: [
        { role: "system", content: d.system },
        { role: "user", content: d.prompt },
      ],
      ...(d.json ? { response_format: { type: "json_object" } } : {}),
    }),
  });

  const text = await res.text();
  if (!res.ok)
    return { ok: false as const, error: `Provider ${res.status}: ${text.slice(0, 300)}` };
  try {
    const j = JSON.parse(text) as { choices?: { message?: { content?: string | null } }[] };
    // Reasoning models put the answer in `content`; some return null there with the text
    // under `reasoning_content`, so fall back rather than sending an empty prompt onward.
    const msg = j.choices?.[0]?.message;
    const content =
      msg?.content ?? (msg as { reasoning_content?: string } | undefined)?.reasoning_content ?? "";
    return { ok: true as const, content };
  } catch {
    return { ok: false as const, error: "Invalid provider response" };
  }
}
