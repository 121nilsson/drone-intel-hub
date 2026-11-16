import {
  compileRuleSnapshot,
  getActiveRuleSnapshot,
  setActiveRuleSnapshot,
  type DynamicRuleRow,
  type RuleSnapshot,
} from "@/shared/contracts/rules";

const TTL_MS = 30_000;
let currentVersion = 0;
let lastChecked = 0;

type Loader = () => Promise<{ version: number; rows: DynamicRuleRow[] } | null>;

const pgLoader: Loader = async () => {
  // Imported on first use, as the driver was: ingestion that never refreshes loads no adapter.
  const { serverServices } = await import("@/shared/infra/server-services.server");
  const { backend, rules } = serverServices();
  if (!backend.capabilities.sql) return null;
  const version = await rules.rulesVersion();
  if (version <= currentVersion) return { version, rows: [] };
  return { version, rows: await rules.activeRules() };
};

/**
 * Active rule snapshot, refreshed at most every TTL. Never throws: on any DB failure the last
 * good snapshot (or the empty one = static lexicons only) is kept, so ingestion never stops.
 */
export async function getOrRefreshRuleSnapshot(
  opts: { force?: boolean; loader?: Loader } = {},
): Promise<RuleSnapshot> {
  const now = Date.now();
  if (!opts.force && now - lastChecked < TTL_MS) return getActiveRuleSnapshot();
  lastChecked = now;
  try {
    const res = await (opts.loader ?? pgLoader)();
    if (res && res.version > currentVersion) {
      setActiveRuleSnapshot(compileRuleSnapshot(res.rows, res.version));
      currentVersion = res.version;
    }
  } catch (err) {
    console.warn("[rule-registry] refresh failed, keeping cached snapshot:", err);
  }
  return getActiveRuleSnapshot();
}

/** Test hook: forget the cached version so the next call reloads. */
export function resetRuleRegistry() {
  currentVersion = 0;
  lastChecked = 0;
}
