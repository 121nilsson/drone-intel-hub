import { createServerFn } from "@tanstack/react-start";

interface ProxyInput { baseUrl: string; apiKey: string; model: string; system: string; prompt: string; json: boolean }

/** Server-side proxy to any OpenAI-compatible endpoint (NVIDIA NIM, OpenAI, vLLM...). */
export const chatCompletion = createServerFn({ method: "POST" })
  .inputValidator((d: ProxyInput) => {
    if (!d.baseUrl.startsWith("https://")) throw new Error("Base URL must be https");
    if (!d.apiKey || !d.model) throw new Error("API key and model required");
    return d;
  })
  .handler(async ({ data }) => {
    const res = await fetch(`${data.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.apiKey}` },
      body: JSON.stringify({
        model: data.model,
        messages: [{ role: "system", content: data.system }, { role: "user", content: data.prompt }],
        ...(data.json ? { response_format: { type: "json_object" } } : {}),
      }),
    });
    const text = await res.text();
    if (!res.ok) return { ok: false as const, error: `Provider ${res.status}: ${text.slice(0, 300)}` };
    try {
      const j = JSON.parse(text) as { choices?: { message?: { content?: string } }[] };
      return { ok: true as const, content: j.choices?.[0]?.message?.content ?? "" };
    } catch { return { ok: false as const, error: "Invalid provider response" }; }
  });
