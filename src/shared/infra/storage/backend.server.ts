import type { BackendCapabilities, BackendKind, StorageBackend } from "@/shared/contracts/backend";
import {
  canCountArchive,
  type DispatchCounts,
  type ServerDocumentStore,
} from "@/shared/contracts/store";
import { storageEnv } from "@/shared/infra/config.server";

/** DATABASE_URL (self-hosted PostgreSQL) wins; otherwise Lovable Cloud when configured. */
export function detectBackendKind(): BackendKind {
  const env = storageEnv();
  if (env.databaseUrl) return "postgres";
  if (env.supabaseUrl && env.supabaseServiceRoleKey) return "cloud";
  return "none";
}

// Lovable Cloud reports revision 0 and stays last-write-wins (docs/architecture.md), so a client must
// not run unattended bulk writes against it on the assumption that conflicts are caught.
const CAPABILITIES: Record<BackendKind, BackendCapabilities> = {
  postgres: { revisions: true, sql: true },
  cloud: { revisions: false, sql: false },
  none: { revisions: true, sql: false },
};

/** Stores are imported lazily so the Supabase client and the driver load only when used. */
const STORES: Record<BackendKind, () => Promise<ServerDocumentStore>> = {
  postgres: async () => {
    const { PostgresStore } = await import("@/shared/infra/postgres/postgres-store.server");
    return new PostgresStore();
  },
  // `none` keeps the long-standing behaviour: the browser does not call the server stores when no
  // backend is configured, and a stray call fails inside the Cloud store with its own message.
  cloud: async () => {
    const { CloudStore } = await import("@/shared/infra/cloud/cloud-store.server");
    return new CloudStore();
  },
  none: async () => {
    const { CloudStore } = await import("@/shared/infra/cloud/cloud-store.server");
    return new CloudStore();
  },
};

export function createBackend(kind: BackendKind = detectBackendKind()): StorageBackend {
  let store: Promise<ServerDocumentStore> | undefined;
  const documents = () => (store ??= STORES[kind]());
  return {
    kind,
    capabilities: CAPABILITIES[kind],
    serverStorage: kind !== "none",
    documents,
    async archiveCounts(): Promise<DispatchCounts | null> {
      if (kind === "none") return null;
      const s = await documents();
      return canCountArchive(s) ? s.archiveCounts() : null;
    },
  };
}
