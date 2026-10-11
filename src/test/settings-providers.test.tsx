import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SettingsPage } from "@/features/settings/settings-page";
import { useServices } from "@/shared/infra/services";
import type { ProviderEnvConfig, ProviderStatus } from "@/shared/contracts/ai";

/**
 * The routing panel is diagnostics, so what it must never do is quietly mislead: no provider with
 * a key, or a fallback that cannot resolve the model id, both have to be visible rather than
 * inferred. Rendering it is the only way to be sure the facts reach the operator.
 */

vi.mock("@/shared/infra/services", () => ({
  useServices: () => mockServices,
  DEFAULT_SETTINGS: {
    baseUrl: "",
    apiKey: "",
    tier1Model: "",
    tier2Model: "",
    translateModel: "",
    escalationThreshold: 0.6,
    autoMergeThreshold: 0.85,
    autoPromoteThreshold: 0.9,
    autoDiscardThreshold: 0.25,
    heuristicFirst: true,
  },
}));

let mockServices: ReturnType<typeof buildServices>;

function buildServices(providerEnv: ProviderEnvConfig | null) {
  return {
    settings: {
      baseUrl: "",
      apiKey: "",
      tier1Model: providerEnv?.tier1Model ?? "",
      tier2Model: providerEnv?.tier2Model ?? "",
      translateModel: "",
      escalationThreshold: 0.6,
      autoMergeThreshold: 0.85,
      autoPromoteThreshold: 0.9,
      autoDiscardThreshold: 0.25,
      heuristicFirst: true,
    },
    saveSettings: () => {},
    aiKeyFromEnv: false,
    aiFromEnv: true,
    providerEnv,
  } as unknown as ReturnType<typeof useServices>;
}

const provider = (name: string, over: Partial<ProviderStatus> = {}) => ({
  name,
  baseUrl: `https://${name}.test/v1`,
  defaultModel: `${name}/default-model`,
  tier1Model: `${name}/tier1-model`,
  tier2Model: `${name}/tier2-model`,
  priority: 10,
  hasKey: true,
  keyEnv: `${name.toUpperCase()}_API_KEY`,
  ...over,
});

const routing = (over: Partial<NonNullable<ProviderEnvConfig["routing"]>> = {}) => ({
  providers: [provider("nvidia"), provider("groq")],
  available: ["nvidia", "groq"],
  multiProvider: true,
  strategy: "priority" as const,
  routes: [
    { tier: "tier1" as const, primary: "groq", fallbacks: ["nvidia"] },
    { tier: "tier2" as const, primary: "nvidia", fallbacks: ["groq"] },
  ],
  ...over,
});

const renderWith = (providerEnv: ProviderEnvConfig | null) => {
  mockServices = buildServices(providerEnv);
  return render(<SettingsPage />);
};

describe("Settings: provider routing panel", () => {
  it("lists every provider with its base URL, default model and credential", () => {
    renderWith({ hasKey: true, routing: routing() });

    expect(screen.getByText("nvidia")).toBeTruthy();
    expect(screen.getByText("groq")).toBeTruthy();
    expect(screen.getByText("https://nvidia.test/v1")).toBeTruthy();
    expect(screen.getByText("nvidia/default-model")).toBeTruthy();
    expect(screen.getByText("NVIDIA_API_KEY set")).toBeTruthy();
  });

  it("shows the requested models and the configured order", () => {
    const { container } = renderWith({
      hasKey: true,
      tier1Model: "nvidia/nemotron-3-super-120b-a12b",
      routing: routing(),
    });

    // The id also appears in the drift note, so scope to the summary line.
    expect(container.textContent).toContain(
      "Tier 1 requests nvidia/nemotron-3-super-120b-a12b — first tried on nvidia",
    );
    // The chain asks each provider for its OWN model, which is the point of the panel.
    expect(container.textContent).toContain("groq → groq/tier1-model");
    expect(screen.getByText(/tier1 configured order \(not used for routing\)/)).toBeTruthy();
  });

  it("warns that a namespaced model quietly changes when its provider goes down", () => {
    renderWith({
      hasKey: true,
      tier1Model: "nvidia/nemotron-3-super-120b-a12b",
      routing: routing(),
    });

    // The old wording claimed fallback could not resolve the id. That is fixed: each provider now
    // gets its own model. The residual risk is silent model drift, which is what this states.
    expect(screen.getByText(/quietly switches to the fallback models above/)).toBeTruthy();
    expect(screen.queryByText(/doomed request/)).toBeNull();
  });

  it("does not raise that warning for a bare model id", () => {
    const { container } = renderWith({
      hasKey: true,
      tier1Model: "gpt-4o-mini",
      routing: routing(),
    });

    expect(container.textContent).toContain("Tier 1 requests gpt-4o-mini");
    expect(screen.queryByText(/quietly switches to the fallback models above/)).toBeNull();
  });

  it("does not raise it when only one provider is configured", () => {
    renderWith({
      hasKey: true,
      tier1Model: "nvidia/nemotron-3-super-120b-a12b",
      routing: routing({
        providers: [provider("nvidia")],
        available: ["nvidia"],
        multiProvider: false,
      }),
    });

    expect(screen.getByText("single provider")).toBeTruthy();
    expect(screen.queryByText(/quietly switches to the fallback models above/)).toBeNull();
  });

  it("says plainly when no provider has a key", () => {
    renderWith({
      hasKey: false,
      routing: routing({
        providers: [provider("nvidia", { hasKey: false, keyEnv: "NVIDIA_API_KEY" })],
        available: [],
        multiProvider: false,
      }),
    });

    expect(screen.getByText(/No provider has a key set/)).toBeTruthy();
    expect(screen.getByText("no key")).toBeTruthy();
  });

  it("explains itself when the server reported no provider table", () => {
    renderWith({ hasKey: false });

    expect(screen.getByText(/did not report a provider table/)).toBeTruthy();
  });

  // A provider without a key must still be listed - an operator cannot set a variable for a
  // provider they cannot see.
  it("lists providers that have no key yet", () => {
    renderWith({
      hasKey: false,
      routing: routing({
        providers: [provider("nvidia"), provider("groq", { hasKey: false })],
        available: ["nvidia"],
        multiProvider: false,
      }),
    });

    expect(screen.getByText("groq")).toBeTruthy();
    expect(screen.getByText("no key")).toBeTruthy();
  });
});
