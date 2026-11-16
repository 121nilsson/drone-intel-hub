import path from "node:path";
import { RuleTester } from "eslint";
import { describe, it } from "vitest";
import tseslint from "typescript-eslint";
import repoRules from "../../eslint-rules/index.js";

/**
 * Domain code reaches storage through ports from serverServices(); the driver, the pool, the
 * concrete stores and the Supabase client belong to their adapters. This is the rule that keeps a
 * new SQL statement from quietly landing in a domain module again.
 */
RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({ languageOptions: { parser: tseslint.parser } });
const SRC = path.resolve(import.meta.dirname, "..");
const domain = path.join(SRC, "shared", "infra", "evaluation", "probe.server.ts");
const adapter = path.join(SRC, "shared", "infra", "postgres", "probe.server.ts");
const cloud = path.join(SRC, "shared", "infra", "cloud", "probe.server.ts");
const backend = path.join(SRC, "shared", "infra", "storage", "backend.server.ts");
const test = path.join(SRC, "test", "probe.test.ts");

tester.run("no-raw-db-import", repoRules.rules["no-raw-db-import"]!, {
  valid: [
    { code: 'import { db } from "@/shared/infra/postgres/db.server";', filename: adapter },
    { code: 'import postgres from "postgres";', filename: adapter },
    { code: 'import("@/integrations/supabase/client.server");', filename: cloud },
    { code: 'import("@/shared/infra/postgres/postgres-store.server");', filename: backend },
    { code: 'import { db } from "@/shared/infra/postgres/db.server";', filename: test },
    {
      code: 'import { serverServices } from "@/shared/infra/server-services.server";',
      filename: domain,
    },
    { code: 'import { x } from "@/shared/infra/postgres/ledger-repo.server";', filename: domain },
  ],
  invalid: [
    {
      code: 'import { db } from "@/shared/infra/postgres/db.server";',
      filename: domain,
      errors: [{ messageId: "rawDb" }],
    },
    {
      code: 'import { db } from "../postgres/db.server";',
      filename: domain,
      errors: [{ messageId: "rawDb" }],
    },
    {
      code: 'const { db } = await import("@/shared/infra/postgres/db.server");',
      filename: domain,
      errors: [{ messageId: "rawDb" }],
    },
    {
      code: 'import { PostgresStore } from "@/shared/infra/postgres/postgres-store.server";',
      filename: domain,
      errors: [{ messageId: "rawDb" }],
    },
    {
      code: 'import postgres from "postgres";',
      filename: domain,
      errors: [{ messageId: "rawDb" }],
    },
    {
      code: 'import type { JSONValue } from "postgres";',
      filename: domain,
      errors: [{ messageId: "rawDb" }],
    },
    {
      code: 'import { supabaseAdmin } from "@/integrations/supabase/client.server";',
      filename: domain,
      errors: [{ messageId: "rawDb" }],
    },
  ],
});
