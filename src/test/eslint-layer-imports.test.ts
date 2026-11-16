import path from "node:path";
import { RuleTester } from "eslint";
import { describe, it } from "vitest";
import tseslint from "typescript-eslint";
import repoRules from "../../eslint-rules/index.js";

/**
 * The layer rules must see every form that loads a module. A slice could otherwise forward a
 * sibling through a re-export, or pull one in lazily with import(), without tripping lint.
 */
RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({ languageOptions: { parser: tseslint.parser } });
const SRC = path.resolve(import.meta.dirname, "..");
const alpha = path.join(SRC, "features", "alpha", "probe.ts");
const shared = path.join(SRC, "shared", "ui", "probe.ts");
const entities = path.join(SRC, "entities", "drone", "probe.ts");
const client = path.join(SRC, "shared", "infra", "probe.ts");
const server = path.join(SRC, "shared", "infra", "probe.server.ts");
const script = path.join(path.resolve(SRC, ".."), "scripts", "probe.ts");

tester.run("no-cross-feature-import", repoRules.rules["no-cross-feature-import"]!, {
  valid: [
    { code: 'import { x } from "@/features/alpha/widget";', filename: alpha },
    { code: 'const load = () => import("@/features/alpha/widget");', filename: alpha },
    { code: 'export { x } from "@/features/alpha/widget";', filename: alpha },
    { code: 'export * from "@/entities/drone/types";', filename: alpha },
  ],
  invalid: [
    {
      code: 'const load = () => import("@/features/beta/widget");',
      filename: alpha,
      errors: [{ messageId: "crossFeature" }],
    },
    {
      code: 'export { x } from "@/features/beta/widget";',
      filename: alpha,
      errors: [{ messageId: "crossFeature" }],
    },
    {
      code: 'export * from "../beta/widget";',
      filename: alpha,
      errors: [{ messageId: "crossFeature" }],
    },
  ],
});

tester.run("no-lower-layer-feature-import", repoRules.rules["no-lower-layer-feature-import"]!, {
  valid: [
    { code: 'import { x } from "@/entities/drone/types";', filename: shared },
    { code: 'const load = () => import("@/shared/ui/primitives");', filename: entities },
    { code: 'export { x } from "@/shared/contracts/repository";', filename: entities },
  ],
  invalid: [
    {
      code: 'const load = () => import("@/features/alpha/widget");',
      filename: shared,
      errors: [{ messageId: "lowerLayer" }],
    },
    {
      code: 'export { x } from "@/features/alpha/widget";',
      filename: entities,
      errors: [{ messageId: "lowerLayer" }],
    },
    {
      code: 'export * from "@/features/alpha/widget";',
      filename: shared,
      errors: [{ messageId: "lowerLayer" }],
    },
  ],
});

tester.run("no-server-import-from-client", repoRules.rules["no-server-import-from-client"]!, {
  valid: [
    { code: 'import type { X } from "@/shared/infra/probe.server";', filename: alpha },
    { code: 'import { type X } from "@/shared/infra/probe.server";', filename: alpha },
    { code: 'export type { X } from "@/shared/infra/probe.server";', filename: alpha },
    { code: 'export { type X } from "@/shared/infra/probe.server";', filename: alpha },
    { code: 'const load = () => import("@/shared/infra/probe.server");', filename: server },
    { code: 'const load = () => import("@/shared/infra/probe.server");', filename: script },
  ],
  invalid: [
    {
      code: 'const load = () => import("@/shared/infra/probe.server");',
      filename: alpha,
      errors: [{ messageId: "serverImport" }],
    },
    {
      code: 'export { x } from "@/shared/infra/probe.server";',
      filename: alpha,
      errors: [{ messageId: "serverImport" }],
    },
    {
      code: 'export * from "@/shared/infra/probe.server";',
      filename: alpha,
      errors: [{ messageId: "serverImport" }],
    },
    {
      // A side-effect import binds no name but still puts the server module in the bundle.
      code: 'import "@/shared/infra/probe.server";',
      filename: client,
      errors: [{ messageId: "serverImport" }],
    },
  ],
});
