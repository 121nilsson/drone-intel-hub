import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { detectLanguageWithEvidence } from "@/entities/normalization/language";
import { buildFrame } from "@/entities/normalization/semantic-eval/sampling";
import {
  CODE_SEED_SNAPSHOT,
  SEMANTIC_RESOLVER_VERSION,
} from "@/entities/normalization/semantic-resolver";

/**
 * Translation has its own route: TRANSLATE_PROVIDER goes first with TRANSLATE_MODEL (or its own
 * translation model), the others follow with theirs, and neither the tier models nor anything the
 * browser holds is involved. `fetch` is stubbed so the real transport and fall-through run.
 *
 * Pacing is read at import, so it is set before the dynamic import (see provider-fallback.test).
 */
process.env["PROVIDER_RPM"] = "0";
process.env["PROVIDER_TIMEOUT_MS"] = "0";
const { translateCompletion, resetProviderState } = await import("@/shared/infra/ai-proxy.server");
const { getTranslationProviders, getTranslationModel } =
  await import("@/shared/infra/ai-providers");

const ENV = [
  "DEEPRELAY_API_KEY",
  "NVIDIA_API_KEY",
  "GROQ_API_KEY",
  "OPENROUTER_API_KEY",
  "MISTRAL_API_KEY",
  "NVIDIA_BASE_URL",
  "DEEPRELAY_BASE_URL",
  "DEEPRELAY_TIER1_MODEL",
  "DEEPRELAY_TRANSLATE_MODEL",
  "NVIDIA_TRANSLATE_MODEL",
  "GROQ_TRANSLATE_MODEL",
  "TRANSLATE_PROVIDER",
  "TRANSLATE_MODEL",
];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  resetProviderState();
  for (const k of ENV) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  process.env["NVIDIA_BASE_URL"] = "https://integrate.api.nvidia.com/v1";
});

afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function stubFetch(fail: (host: string) => boolean = () => false) {
  const seen: { host: string; model: string; system?: string }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init?: { body?: string }) => {
      const u = new URL(String(url));
      const body = JSON.parse(init?.body ?? "{}") as {
        model: string;
        messages?: { role: string; content: string }[];
      };
      seen.push({
        host: u.host,
        model: body.model,
        system: body.messages?.find((m) => m.role === "system")?.content ?? "",
      });
      if (fail(u.host)) return new Response("no such model", { status: 404 });
      return new Response(JSON.stringify({ choices: [{ message: { content: "translated" } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
  return seen;
}

const ask = () => translateCompletion({ system: "translate", prompt: "текст" });

describe("which provider and model translate", () => {
  it("sends the translation to TRANSLATE_PROVIDER first, with that provider's translation model", async () => {
    process.env["DEEPRELAY_API_KEY"] = "k-dr";
    process.env["NVIDIA_API_KEY"] = "k-nv";
    process.env["TRANSLATE_PROVIDER"] = "nvidia";
    const seen = stubFetch();

    const r = await ask();

    expect(r.ok).toBe(true);
    // Deeprelay has priority 5 and would normally answer first; it is not asked at all.
    expect(seen.map(({ host, model }) => ({ host, model }))).toEqual([
      { host: "integrate.api.nvidia.com", model: "nvidia/riva-translate-4b-instruct-v2" },
    ]);
  });

  it("uses TRANSLATE_MODEL for the chosen provider", async () => {
    process.env["NVIDIA_API_KEY"] = "k-nv";
    process.env["TRANSLATE_PROVIDER"] = "nvidia";
    process.env["TRANSLATE_MODEL"] = "nvidia/some-other-translator";
    const seen = stubFetch();

    await ask();

    expect(seen.map((s) => s.model)).toEqual(["nvidia/some-other-translator"]);
  });

  it("falls through to the next provider with ITS translation model, not the first one's id", async () => {
    process.env["NVIDIA_API_KEY"] = "k-nv";
    process.env["DEEPRELAY_API_KEY"] = "k-dr";
    process.env["DEEPRELAY_TRANSLATE_MODEL"] = "deeprelay/deepseek-v4.1-flash";
    process.env["TRANSLATE_PROVIDER"] = "nvidia";
    process.env["TRANSLATE_MODEL"] = "nvidia/riva-custom";
    const seen = stubFetch((host) => host === "integrate.api.nvidia.com");

    const r = await ask();

    expect(r.ok).toBe(true);
    expect(seen.map(({ host, model }) => ({ host, model }))).toEqual([
      { host: "integrate.api.nvidia.com", model: "nvidia/riva-custom" },
      // TRANSLATE_MODEL belongs to the chosen provider and means nothing to the fallback.
      { host: "api.deeprelay.ai", model: "deeprelay/deepseek-v4.1-flash" },
    ]);
  });

  it("without TRANSLATE_PROVIDER follows priority and each provider's own translation model", async () => {
    process.env["DEEPRELAY_API_KEY"] = "k-dr";
    process.env["NVIDIA_API_KEY"] = "k-nv";
    process.env["DEEPRELAY_TRANSLATE_MODEL"] = "deeprelay/deepseek-v4.1-flash";
    const seen = stubFetch();

    await ask();

    expect(seen.map(({ host, model }) => ({ host, model }))).toEqual([
      { host: "api.deeprelay.ai", model: "deeprelay/deepseek-v4.1-flash" },
    ]);
  });

  it("never sends the Groq default that an unconfigured browser holds", async () => {
    process.env["DEEPRELAY_API_KEY"] = "k-dr";
    // No DEEPRELAY_TRANSLATE_MODEL: the provider's tier-1 model stands in, never openai/gpt-oss-20b.
    process.env["DEEPRELAY_TIER1_MODEL"] = "deeprelay/deepseek-v4.1-flash";
    const seen = stubFetch();

    await ask();

    expect(seen.map((s) => s.model)).toEqual(["deeprelay/deepseek-v4.1-flash"]);
  });

  it("ignores a TRANSLATE_PROVIDER that is unknown or has no key", () => {
    process.env["DEEPRELAY_API_KEY"] = "k-dr";
    process.env["TRANSLATE_PROVIDER"] = "nvidia"; // no NVIDIA key
    expect(getTranslationProviders().map((p) => p.name)).toEqual(["deeprelay"]);
    process.env["TRANSLATE_PROVIDER"] = "nope";
    expect(getTranslationProviders().map((p) => p.name)).toEqual(["deeprelay"]);
  });

  it("applies TRANSLATE_MODEL only to the first provider of the chain", () => {
    process.env["DEEPRELAY_API_KEY"] = "k-dr";
    process.env["NVIDIA_API_KEY"] = "k-nv";
    process.env["TRANSLATE_PROVIDER"] = "nvidia";
    process.env["TRANSLATE_MODEL"] = "x/y";
    const chain = getTranslationProviders();
    expect(chain.map((p) => getTranslationModel(p, chain))).toEqual([
      "x/y",
      "deeprelay/deepseek-v4.1-flash",
    ]);
  });
});

describe("AI_SKIP_PROVIDERS", () => {
  it("leaves a provider out of the extraction chain but keeps it for translation", async () => {
    const { getAvailableProviders } = await import("@/shared/infra/ai-providers");
    process.env["DEEPRELAY_API_KEY"] = "k-dr";
    process.env["NVIDIA_API_KEY"] = "k-nv";
    process.env["AI_SKIP_PROVIDERS"] = " Nvidia ,nope";
    try {
      expect(getAvailableProviders().map((p) => p.name)).toEqual(["deeprelay"]);
      expect(getTranslationProviders().map((p) => p.name)).toEqual(["deeprelay", "nvidia"]);
    } finally {
      delete process.env["AI_SKIP_PROVIDERS"];
    }
    expect(getAvailableProviders().map((p) => p.name)).toEqual(["deeprelay", "nvidia"]);
  });
});

describe("Riva-Translate gets its language pair, not an instruction", () => {
  const riva = () => {
    process.env["NVIDIA_API_KEY"] = "k-nv";
    process.env["TRANSLATE_PROVIDER"] = "nvidia";
  };
  const askWith = (prompt: string) =>
    translateCompletion({ system: "Translate to English.", prompt });

  it("names the pair for Russian and for Ukrainian", async () => {
    riva();
    const seen = stubFetch();
    await askWith("ВСУ сообщили, что ударные беспилотники атаковали Одессу ночью, потерь нет");
    await askWith(
      "Збройні Сили України знищили понад 8000 російських дронів і ракет, відбиваючи атаки",
    );
    expect(seen.map((s) => s.system)).toEqual(["ru-en", "uk-en"]);
  });

  it("keeps the instruction for a language it cannot name, which Riva follows for non-English text", async () => {
    riva();
    const seen = stubFetch();
    await askWith(
      "Siły Zbrojne Ukrainy zniszczyły ponad 8000 rosyjskich dronów i rakiet w październiku",
    );
    expect(seen[0]?.system).toBe("Translate to English.");
  });

  it("leaves an instruct model's prompt alone", async () => {
    process.env["DEEPRELAY_API_KEY"] = "k-dr";
    const seen = stubFetch();
    await askWith("ВСУ сообщили, что ударные беспилотники атаковали Одессу ночью, потерь нет");
    expect(seen[0]?.system).toBe("Translate to English.");
  });

  it("shapes the request per provider on a fall-through", async () => {
    process.env["NVIDIA_API_KEY"] = "k-nv";
    process.env["DEEPRELAY_API_KEY"] = "k-dr";
    process.env["TRANSLATE_PROVIDER"] = "nvidia";
    const seen = stubFetch((host) => host === "integrate.api.nvidia.com");
    await askWith("ВСУ сообщили, что ударные беспилотники атаковали Одессу ночью, потерь нет");
    // Riva got the pair; the instruct model behind it got the instruction.
    expect(seen.map((s) => s.system)).toEqual(["ru-en", "Translate to English."]);
  });
});

describe("translation routing follows the language evidence (D0)", () => {
  const riva = () => {
    process.env["NVIDIA_API_KEY"] = "k-nv";
    process.env["TRANSLATE_PROVIDER"] = "nvidia";
  };
  const askWith = (prompt: string) =>
    translateCompletion({ system: "Translate to English.", prompt });

  it("sends short Ukrainian with one distinguishing letter as uk-en", async () => {
    riva();
    const seen = stubFetch();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await askWith("Дрон має дальність польоту 250 км.");
    await askWith("Заявлена потужність двигуна — 80 кВт.");
    expect(seen.map((s) => s.system)).toEqual(["uk-en", "uk-en"]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("does not let a sentence-initial word decide: ru-en as before D0, and logged", async () => {
    riva();
    const seen = stubFetch();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await askWith("Дальність польоту становить 250 км.");
    await askWith("Укрзалізниця сообщила о задержке поезда.");
    expect(seen.map((s) => s.system)).toEqual(["ru-en", "ru-en"]);
    expect(
      warn.mock.calls.filter((c) => String(c[0]).includes("cyrillic_undetermined")),
    ).toHaveLength(2);
  });

  it("keeps ru-en for Cyrillic it cannot place (decision a) and logs reason and counts only", async () => {
    riva();
    const seen = stubFetch();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await askWith("Корисне навантаження становить 35 кг.");
    expect(seen[0]?.system).toBe("ru-en");
    const lines = warn.mock.calls.map((c) => String(c[0]));
    const line = lines.find((l) => l.includes("cyrillic_undetermined"));
    expect(line).toBeDefined();
    expect(line).toMatch(/cyrillic=\d+ latin=0 uk_only=0 ru_only=0/);
    expect(lines.join("\n")).not.toContain("навантаження");
  });

  it("routes Russian that names a Ukrainian outlet as ru-en, as before D0", async () => {
    riva();
    const seen = stubFetch();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await askWith("Агентство Укрінформ сообщает о новом дроне.");
    expect(seen[0]?.system).toBe("ru-en");
  });

  it("still short-circuits English: no pair, instruction kept", async () => {
    riva();
    const seen = stubFetch();
    await askWith("The drone has a range of 250 km and it can be launched from a truck.");
    expect(seen[0]?.system).toBe("Translate to English.");
  });
});

describe("language provenance end to end (D0)", () => {
  const run = async (sentence: string) => {
    process.env["NVIDIA_API_KEY"] = "k-nv";
    process.env["TRANSLATE_PROVIDER"] = "nvidia";
    const seen = stubFetch();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    // 1. detection
    const detection = detectLanguageWithEvidence(sentence);
    // 2. translation routing
    await translateCompletion({ system: "Translate to English.", prompt: sentence });
    // 3. a frame row with no declared language becomes a frozen example;
    // 4. the resolver call records what it was given.
    const resolveSpy = vi.fn((input: Parameters<typeof CODE_SEED_SNAPSHOT.resolve>[0]) =>
      CODE_SEED_SNAPSHOT.resolve(input),
    );
    const snapshot = { ...CODE_SEED_SNAPSHOT, resolve: resolveSpy };
    const built = buildFrame(
      [
        {
          sourceId: "dispatch-e2e",
          rawKey: "range_km",
          rawValue: "250",
          excerpt: sentence,
          publishedAt: "2026-03-02T00:00:00.000Z",
        },
      ],
      {
        frameId: "e2e",
        snapshot,
        resolverVersion: SEMANTIC_RESOLVER_VERSION,
        schemaVersion: "1.1.0",
      },
    );
    return { detection, system: seen[0]?.system, warn, example: built.examples[0]!, resolveSpy };
  };

  it("short decisive Ukrainian: uk, uk-en, detected not declared, resolver gets uk", async () => {
    const r = await run("Дрон має дальність польоту 250 км.");
    expect(r.detection).toMatchObject({ language: "uk", decisive: true });
    expect(r.system).toBe("uk-en");
    expect(r.example.declaredLanguage).toBeUndefined();
    expect(r.example.detectedLanguage).toBe("uk");
    expect(r.example.languageDetectionDecisive).toBe(true);
    expect(r.example.language).toBe("uk");
    expect(r.resolveSpy).toHaveBeenCalledTimes(1);
    expect(r.resolveSpy.mock.calls[0]![0]).toMatchObject({ language: "uk" });
  });

  it("short Ukrainian whose only distinctive letter is in the first word: not decisive, ru-en, no language", async () => {
    const r = await run("Дальність польоту становить 250 км.");
    expect(r.detection).toMatchObject({ language: "ru", decisive: false });
    expect(r.system).toBe("ru-en");
    expect(r.example.declaredLanguage).toBeUndefined();
    expect(r.example.language).toBe("unknown");
    expect("language" in r.resolveSpy.mock.calls[0]![0]).toBe(false);
  });

  it("undecidable Ukrainian: ru-en kept, cyrillic_undetermined logged, resolver gets no language", async () => {
    const r = await run("Корисне навантаження становить 35 кг.");
    expect(r.detection).toMatchObject({
      language: "ru",
      decisive: false,
      reason: "cyrillic_undetermined",
    });
    expect(r.system).toBe("ru-en");
    expect(r.warn.mock.calls.some((c) => String(c[0]).includes("cyrillic_undetermined"))).toBe(
      true,
    );
    expect(r.example.declaredLanguage).toBeUndefined();
    expect(r.example.detectedLanguage).toBe("ru");
    expect(r.example.languageDetectionDecisive).toBe(false);
    expect(r.example.languageDetectionReason).toBe("cyrillic_undetermined");
    expect(r.example.language).toBe("unknown");
    expect(r.resolveSpy).toHaveBeenCalledTimes(1);
    expect("language" in r.resolveSpy.mock.calls[0]![0]).toBe(false);
  });
});
