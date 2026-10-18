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
  const { db, dbConfigured } = await import("@/shared/infra/postgres/db.server");
  if (!dbConfigured()) return null;
  const [v] = await db()`select coalesce(max(version), 0)::int as version from dynamic_rules_version`;
  const version = Number(v?.["version"] ?? 0);
  if (version <= currentVersion) return { version, rows: [] };
  const rows = await db()`select id, kind, language, payload from dynamic_rules where status = 'active'`;
  return { version, rows: rows as unknown as DynamicRuleRow[] };
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
