import type { ReactNode } from "react";
import { useServices } from "@/shared/infra/use-services";
import { DataTable, type Column } from "@/shared/ui/data-table";
import { PageTitle, Panel, Tag } from "@/shared/ui/primitives";
import { DensityToggle } from "@/shared/ui/density";
import { ThemeToggle } from "@/shared/ui/theme";
import type { AIProviderSettings, ProviderEnvConfig, ProviderStatus } from "@/shared/contracts/ai";

/** A model id like `nvidia/nemotron-3-super-120b-a12b` or `meta/muse-glimmer-30b` is namespaced to
 * one provider's catalogue and does not exist on the others. Bare ids (`gpt-4o`, `mistral-large`)
 * are ambiguous, so only a namespace is treated as evidence. */
function isNamespaced(model: string): boolean {
  return /^[a-z0-9_-]+\//i.test(model.trim());
}

function providerColumns(available: readonly string[]): Column<ProviderStatus>[] {
  return [
    {
      id: "provider",
      header: "Provider",
      className: "font-mono text-xs",
      cell: (p) => (
        <>
          <span
            className={available.includes(p.name) ? "text-foreground" : "text-muted-foreground"}
          >
            {p.name}
          </span>
          <div className="text-2xs text-muted-foreground">priority {p.priority}</div>
        </>
      ),
    },
    {
      id: "url",
      header: "Base URL",
      className: "break-all font-mono text-2xs text-muted-foreground",
      cell: (p) => p.baseUrl,
    },
    {
      id: "model",
      header: "Default model",
      className: "break-all font-mono text-2xs",
      cell: (p) => p.defaultModel,
    },
    {
      id: "key",
      header: "Credential",
      cell: (p) =>
        p.hasKey ? (
          <Tag tone="accent" title={`Key present in ${p.keyEnv}`}>
            {p.keyEnv} set
          </Tag>
        ) : (
          <Tag title={`Set ${p.keyEnv} on the server to enable`}>no key</Tag>
        ),
    },
  ];
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
        <DataTable
          bare
          label="Providers"
          columns={providerColumns(r.available)}
          rows={r.providers}
          rowKey={(p) => p.name}
        />

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
          {env.translateModel && (
            <div>
              <p>
                Translation uses <span className="text-foreground">{env.translateModel}</span>
                {env.translateProvider && (
                  <>
                    {" "}
                    — first tried on{" "}
                    <span className="text-foreground">{env.translateProvider}</span>
                  </>
                )}
              </p>
              <p className="pl-3">
                set with TRANSLATE_PROVIDER and TRANSLATE_MODEL; every other provider translates
                with its own {"<NAME>"}_TRANSLATE_MODEL
              </p>
            </div>
          )}
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

/** One labelled fact. Values are monospace because they are ids, URLs and numbers. */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid min-w-0 grid-cols-[9rem_1fr] items-baseline gap-3 py-2 text-xs">
      <dt className="font-mono uppercase tracking-widest text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words font-mono text-foreground">{children}</dd>
    </div>
  );
}

const THRESHOLDS: { key: keyof AIProviderSettings; label: string; meaning: string }[] = [
  {
    key: "escalationThreshold",
    label: "Escalate below",
    meaning: "confidence that sends a post to tier 2",
  },
  {
    key: "autoMergeThreshold",
    label: "Auto-merge above",
    meaning: "confidence that merges into an existing system",
  },
  {
    key: "autoPromoteThreshold",
    label: "Auto-promote above",
    meaning: "confidence that adds a new, uniquely named system",
  },
  {
    key: "autoDiscardThreshold",
    label: "Auto-discard below",
    meaning: "confidence under which a post is dropped",
  },
];

export function SettingsPage() {
  const { settings, aiConfigured, providerEnv } = useServices();
  return (
    <div className="max-w-2xl space-y-6">
      <PageTitle subtitle="What the server is configured with. Nothing here is edited in the browser.">
        Settings
      </PageTitle>
      <Panel title="Display density">
        <div className="flex items-center gap-3">
          <DensityToggle />
          <span className="text-xs text-muted-foreground">
            Compact for triage, analyst for comparison.
          </span>
        </div>
      </Panel>
      <Panel title="Theme">
        <div className="flex items-center gap-3">
          <ThemeToggle className="border border-border px-3 py-1.5 font-mono text-xs uppercase tracking-wider" />
          <span className="text-xs text-muted-foreground">Switch between dark and light mode.</span>
        </div>
      </Panel>
      <Panel
        title="Inference"
        right={
          <Tag tone={aiConfigured ? "accent" : "default"}>
            {aiConfigured ? "provider key set" : "local engine only"}
          </Tag>
        }
      >
        <dl className="divide-y divide-border">
          <Fact label="Tier 1">{providerEnv?.tier1Model ?? "built-in local extraction"}</Fact>
          <Fact label="Tier 2">{providerEnv?.tier2Model ?? "built-in local extraction"}</Fact>
          <Fact label="Translation">
            {providerEnv?.translateModel ?? "none"}
            {providerEnv?.translateProvider ? ` · ${providerEnv.translateProvider}` : ""}
          </Fact>
          <Fact label="Base URL">{providerEnv?.baseUrl ?? "none"}</Fact>
          <Fact label="Local first">
            {settings.heuristicFirst
              ? "the deterministic engine runs before any AI call, to save quota"
              : "AI runs on every post"}
          </Fact>
        </dl>
        <p className="mt-3 text-xs text-muted-foreground">
          Set in .env / .env.local on the server: a key per provider ({"<NAME>"}_API_KEY), models
          with {"<NAME>"}_TIER1_MODEL, {"<NAME>"}_TIER2_MODEL and {"<NAME>"}_TRANSLATE_MODEL, and
          the translation route with TRANSLATE_PROVIDER and TRANSLATE_MODEL. Keys never reach the
          browser.
        </p>
      </Panel>
      {providerEnv ? (
        <ProviderRouting env={providerEnv} />
      ) : (
        <Panel title="Providers">
          <p className="text-xs text-muted-foreground">
            The server did not report its provider configuration. It reads environment variables
            that are only available server-side, so the app has to be running with its environment
            loaded.
          </p>
        </Panel>
      )}
      <Panel title="Extraction thresholds">
        <dl className="divide-y divide-border">
          {THRESHOLDS.map((t) => (
            <Fact key={t.key} label={t.label}>
              {String(settings[t.key])}
              <span className="ml-2 font-sans text-muted-foreground">{t.meaning}</span>
            </Fact>
          ))}
        </dl>
        <p className="mt-3 text-xs text-muted-foreground">
          Built into the app (src/shared/infra/settings-defaults.ts) and the same for the server
          sync and for manual intake.
        </p>
      </Panel>
    </div>
  );
}
