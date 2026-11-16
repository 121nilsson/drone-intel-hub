import type { SeedAuditReader } from "@/shared/contracts/evaluation-repo";

/** No database: the seed measurement reports "unavailable" (null means no database, not no rows). */
export const nullSeedAuditReader: SeedAuditReader = {
  seedAuditRows: async () => null,
};
