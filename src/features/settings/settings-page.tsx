import { useEffect, useState } from "react";
import { DEFAULT_SETTINGS, useServices } from "@/shared/infra/services";
import { Btn, Panel, Tag } from "@/shared/ui/primitives";
import type { ProviderEnvConfig, ProviderStatus } from "@/shared/contracts/ai";

/** A model id like `nvidia/nemotron-3-super-120b-a12b` or `meta/muse-glimmer-30b` is namespaced to
 * one provider's catalogue and does not exist on the others. Bare ids (`gpt-4o`, `mistral-large`)
 * are ambiguous, so only a namespace is treated as evidence. */
function isNamespaced(model: string): boolean {
  return /^[a-z0-9_-]+\//i.test(model.trim());
}

function ProviderRow({ p, live }: { p: ProviderStatus; live: boolean }) {
  return (
    <tr className="border-t border-border/60 align-top">
      <td className="py-2 pr-3 font-mono text-xs">
        <span className={live ? "text-foreground" : "text-muted-foreground"}>{p.name}</span>
        <div className="text-[11px] text-muted-foreground">priority {p.priority}</div>
      </td>
      <td className="py-2 pr-3 font-mono text-[11px] break-all text-muted-foreground">
        {p.baseUrl}
      </td>
      <td className="py-2 pr-3 font-mono text-[11px] break-all">{p.defaultModel}</td>
      <td className="py-2">
        {p.hasKey ? (
          <Tag tone="accent" title={`Key present in ${p.keyEnv}`}>
            {p.keyEnv} set
          </Tag>
        ) : (
          <Tag title={`Set ${p.keyEnv} on the server to enable`}>no key</Tag>
        )}
      </td>
    </tr>
  );
}

/**
 * Which providers the server actually loaded, and what each will answer with.
 *
 * The fields above show the model ids the app *asks for*; this shows the providers that will be
 * *asked*. Those are different things, and the gap between them is where a fallback silently
 * costs latency, so it is stated rather than left for the operator to infer.
 */
function ProviderRouting({ env }: { env: ProviderEnvConfig }) {
  const r = env.routing;
  if (!r) {
    return (
      <Panel title="Providers">
        <p className="text-xs text-muted-foreground">
          The server did not report a provider table. It reads environment variables that are only
          available server-side, so this needs the app running with its environment loaded.
        </p>
      </Panel>
    );
  }

  const requested = [
    { key: "tier1", label: "Tier 1", model: env.tier1Model },
    { key: "tier2", label: "Tier 2", model: env.tier2Model },
  ].filter((x): x is { key: "tier1" | "tier2"; label: string; model: string } => !!x.model);

  // The chain is priority order, and the FIRST provider is handed the configured model verbatim.
  // Every provider after it is handed its own resolved model for that tier, so a fallback is a
  // real second attempt rather than a replay of an id that provider cannot resolve.
  const chain = r.providers.filter((p) => r.available.includes(p.name));
  const fallbacksFor = (tier: "tier1" | "tier2") =>
    chain.slice(1).map((p) => ({ name: p.name, model: p[`${tier}Model`] }));

  // What is still worth knowing: a namespaced configured model is only served by whichever
  // provider owns it. When that provider is unavailable the tier silently runs on a different
  // model, which changes extraction quality without anything looking broken.
  const drift = requested.filter((x) => isNamespaced(x.model) && fallbacksFor(x.key).length > 0);

  return (
    <Panel
      title="Providers"
      right={
        <Tag tone={r.multiProvider ? "accent" : "default"}>
          {r.multiProvider ? `multi-provider · ${r.strategy}` : "single provider"}
        </Tag>
      }
    >
      <div className="space-y-4">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="text-left font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
                <th className="pb-1 pr-3 font-normal">provider</th>
                <th className="pb-1 pr-3 font-normal">base URL</th>
                <th className="pb-1 pr-3 font-normal">default model</th>
                <th className="pb-1 font-normal">credential</th>
              </tr>
            </thead>
            <tbody>
              {r.providers.map((p) => (
                <ProviderRow key={p.name} p={p} live={r.available.includes(p.name)} />
              ))}
            </tbody>
          </table>
        </div>

        <div className="space-y-2 font-mono text-[11px] text-muted-foreground">
          {requested.map((x) => {
            const fb = fallbacksFor(x.key);
            return (
              <div key={x.key}>
                <p>
                  {x.label} requests <span className="text-foreground">{x.model}</span>
                  {chain.length > 0 && (
                    <>
                      {" "}
                      — first tried on <span className="text-foreground">{chain[0]!.name}</span>
                    </>
                  )}
                </p>
                {fb.length > 0 && (
                  <p className="pl-3">
                    if unavailable:{" "}
                    {fb.map((f, i) => (
                      <span key={f.name}>
                        {i > 0 && " · "}
                        {f.name} → <span className="text-foreground">{f.model}</span>
                      </span>
                    ))}
                  </p>
                )}
              </div>
            );
          })}
          {r.routes.map((route) => (
            <p key={route.tier}>
              {route.tier} configured order (not used for routing): {route.primary}
              {route.fallbacks.length ? ` → ${route.fallbacks.join(" → ")}` : ""}
            </p>
          ))}
        </div>

        {drift.length > 0 && (
          <p className="border-l-2 border-accent/60 pl-3 text-xs text-muted-foreground">
            {drift.map((x) => x.model).join(" and ")}{" "}
            {drift.length === 1 ? "is namespaced" : "are namespaced"} to a single provider&apos;s
            catalogue, so only {chain[0]?.name ?? "the first provider"} can serve{" "}
            {drift.length === 1 ? "it" : "them"}. While that provider is up{" "}
            {drift.length === 1 ? "this model" : "these models"} {drift.length === 1 ? "is" : "are"}{" "}
            what runs; if it goes down, {drift.length === 1 ? "the tier" : "the tiers"} quietly{" "}
            {drift.length === 1 ? "switches" : "switch"} to the fallback models above.
          </p>
        )}
        {!r.available.length && (
          <p className="border-l-2 border-destructive/60 pl-3 text-xs text-muted-foreground">
            No provider has a key set. Ingestion is running on the built-in local extraction engine.
          </p>
        )}
      </div>
    </Panel>
  );
}

export function SettingsPage() {
  const { settings, saveSettings, aiKeyFromEnv, aiFromEnv, providerEnv } = useServices();
  const [s, setS] = useState(settings);
  const [saved, setSaved] = useState(false);
  useEffect(() => setS(settings), [settings]);
  const field = (k: keyof typeof s, label: string, type = "text") => (
    <label className="block">
      <span className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      <input
        type={type}
        step="0.05"
        value={String(s[k])}
        onChange={(e) =>
          setS({ ...s, [k]: type === "number" ? Number(e.target.value) : e.target.value })
        }
        className="mt-1 w-full border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:border-primary"
      />
    </label>
  );
  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-3xl font-semibold">Settings</h1>
      {providerEnv && <ProviderRouting env={providerEnv} />}
      <Panel title="Inference provider (NVIDIA NIM / OpenAI-compatible)">
        <div className="space-y-4">
          {field("baseUrl", "Base URL")}
          {field("apiKey", "API key", "password")}
          {field("tier1Model", "Tier 1 model (fast screening)")}
          {field("tier2Model", "Tier 2 model (reasoning escalation)")}
          {field("translateModel", "Translation model")}
          <div className="grid grid-cols-2 gap-4">
            {field("escalationThreshold", "Escalate below", "number")}
            {field("autoMergeThreshold", "Auto-merge above", "number")}
          </div>
          <div className="grid grid-cols-2 gap-4">
            {field("autoPromoteThreshold", "Auto-promote new system above", "number")}
            {field("autoDiscardThreshold", "Auto-discard below", "number")}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={s.heuristicFirst}
              onChange={(e) => setS({ ...s, heuristicFirst: e.target.checked })}
            />
            Run local deterministic extraction before using AI quota
          </label>
          <p className="text-xs text-muted-foreground">
            {aiKeyFromEnv
              ? "A provider key is set on the server (.env / .env.local) — it overrides the fields above and stays on the server. Remove every server key to fall back to a key saved in this browser."
              : aiFromEnv
                ? "Model and URL values above come from the server environment (.env / .env.local). Save a key in this browser or set a provider key (e.g. GROQ_API_KEY, NVIDIA_API_KEY) on the server to enable remote inference."
                : "Key is kept in this browser only and forwarded per request. Leave empty to use the built-in local extraction engine."}
          </p>
          <div className="flex gap-2">
            <Btn
              onClick={() => {
                saveSettings(s);
                setSaved(true);
                setTimeout(() => setSaved(false), 1500);
              }}
            >
              {saved ? "Saved" : "Save"}
            </Btn>
            <Btn variant="ghost" onClick={() => setS(DEFAULT_SETTINGS)}>
              Reset
            </Btn>
          </div>
        </div>
      </Panel>
    </div>
  );
}
