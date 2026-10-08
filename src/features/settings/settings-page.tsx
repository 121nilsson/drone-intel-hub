import { useEffect, useState } from "react";
import { DEFAULT_SETTINGS, useServices } from "@/shared/infra/services";
import { Btn, Panel } from "@/shared/ui/primitives";

export function SettingsPage() {
  const { settings, saveSettings, aiKeyFromEnv, aiFromEnv } = useServices();
  const [s, setS] = useState(settings);
  const [saved, setSaved] = useState(false);
  useEffect(() => setS(settings), [settings]);
  const field = (k: keyof typeof s, label: string, type = "text") => (
    <label className="block">
      <span className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">{label}</span>
      <input type={type} step="0.05" value={String(s[k])} onChange={(e) => setS({ ...s, [k]: type === "number" ? Number(e.target.value) : e.target.value })}
        className="mt-1 w-full border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:border-primary" />
    </label>
  );
  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-3xl font-semibold">Settings</h1>
      <Panel title="Inference provider (NVIDIA NIM / OpenAI-compatible)">
        <div className="space-y-4">
          {field("baseUrl", "Base URL")}
          {field("apiKey", "API key", "password")}
          {field("tier1Model", "Tier 1 model (fast screening)")}
          {field("tier2Model", "Tier 2 model (reasoning escalation)")}
          {field("translateModel", "Translation model")}
          <div className="grid grid-cols-2 gap-4">{field("escalationThreshold", "Escalate below", "number")}{field("autoMergeThreshold", "Auto-merge above", "number")}</div>
          <div className="grid grid-cols-2 gap-4">{field("autoPromoteThreshold", "Auto-promote new system above", "number")}{field("autoDiscardThreshold", "Auto-discard below", "number")}</div>
          <p className="text-xs text-muted-foreground">
            {aiKeyFromEnv
              ? "NVIDIA_API_KEY is set in .env.local — it overrides the fields above and stays on the server. Leave the key blank to fall back to a key saved in this browser."
              : aiFromEnv
                ? "Model and URL values above come from the server environment (.env / .env.local). Save a key in this browser or set NVIDIA_API_KEY on the server to enable remote inference."
                : "Key is kept in this browser only and forwarded per request. Leave empty to use the built-in local extraction engine."}
          </p>
          <div className="flex gap-2">
            <Btn onClick={() => { saveSettings(s); setSaved(true); setTimeout(() => setSaved(false), 1500); }}>{saved ? "Saved" : "Save"}</Btn>
            <Btn variant="ghost" onClick={() => setS(DEFAULT_SETTINGS)}>Reset</Btn>
          </div>
        </div>
      </Panel>
    </div>
  );
}
