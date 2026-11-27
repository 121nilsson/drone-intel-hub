import path from "node:path";
import { RuleTester } from "eslint";
import { describe, it } from "vitest";
import tseslint from "typescript-eslint";
import repoRules from "../../eslint-rules/index.js";

/**
 * No D0 detector version is approved (decision 2026-11-27). Production code decides language with
 * the pre-D0 rule; this rule keeps the detector from creeping back into a production decision
 * (review finding W1).
 */
RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({ languageOptions: { parser: tseslint.parser } });
const SRC = path.resolve(import.meta.dirname, "..");
const feature = path.join(SRC, "features", "dossier", "dossier-summary.tsx");
const functions = path.join(SRC, "shared", "infra", "ai-proxy.functions.ts");
const entity = path.join(SRC, "entities", "normalization", "language-legacy.ts");
const sibling = path.join(SRC, "entities", "normalization", "numeric.ts");
const proxy = path.join(SRC, "shared", "infra", "ai-proxy.server.ts");
const evalCode = path.join(SRC, "entities", "normalization", "semantic-eval", "sampling.ts");
const test = path.join(SRC, "test", "probe.test.ts");
const script = path.join(SRC, "..", "scripts", "probe.ts");

tester.run("no-unapproved-language-detector", repoRules.rules["no-unapproved-language-detector"]!, {
  valid: [
    {
      code: 'import { detectLanguagePreD0 } from "@/entities/normalization/language-legacy";',
      filename: feature,
    },
    { code: 'import type { DetectedLanguage } from "./language";', filename: entity },
    {
      code: 'import { type DetectedLanguage } from "@/entities/normalization/language";',
      filename: functions,
    },
    {
      code: 'import { detectLanguageWithEvidence } from "@/entities/normalization/language";',
      filename: proxy,
    },
    { code: 'import { detectLanguageWithEvidence } from "../language";', filename: evalCode },
    { code: 'import { detectLanguage } from "@/entities/normalization/language";', filename: test },
    {
      code: 'import { detectLanguage } from "../src/entities/normalization/language";',
      filename: script,
    },
  ],
  invalid: [
    {
      code: 'import { detectLanguage } from "@/entities/normalization/language";',
      filename: feature,
      errors: [{ messageId: "unapproved" }],
    },
    {
      code: 'import { detectLanguage } from "@/entities/normalization/language";',
      filename: functions,
      errors: [{ messageId: "unapproved" }],
    },
    {
      code: 'import { detectLanguageWithEvidence } from "./language";',
      filename: sibling,
      errors: [{ messageId: "unapproved" }],
    },
    {
      code: 'export { detectLanguage } from "@/entities/normalization/language";',
      filename: sibling,
      errors: [{ messageId: "unapproved" }],
    },
    {
      code: 'export * from "./language";',
      filename: sibling,
      errors: [{ messageId: "unapproved" }],
    },
    {
      code: 'const m = await import("@/entities/normalization/language");',
      filename: feature,
      errors: [{ messageId: "unapproved" }],
    },
    {
      code: 'import * as lang from "@/entities/normalization/language.ts";',
      filename: feature,
      errors: [{ messageId: "unapproved" }],
    },
  ],
});
