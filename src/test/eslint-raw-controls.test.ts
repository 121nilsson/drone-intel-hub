import path from "node:path";
import { RuleTester } from "eslint";
import { describe, it } from "vitest";
import repoRules from "../../eslint-rules/index.js";

/**
 * Feature slices take their controls from src/shared/ui; the rule is what keeps a page from
 * quietly growing its own hand-styled button again. Shared UI may still build on raw elements,
 * and a checkbox is not a text field.
 */
RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({
  languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
});
const SRC = path.resolve(import.meta.dirname, "..");
const feature = path.join(SRC, "features", "catalog", "probe.tsx");
const shared = path.join(SRC, "shared", "ui", "probe.tsx");

tester.run("no-raw-controls", repoRules.rules["no-raw-controls"]!, {
  valid: [
    { code: "const x = <Btn>Go</Btn>;", filename: feature },
    { code: 'const x = <input type="checkbox" />;', filename: feature },
    { code: "const x = <button>Raw is fine here</button>;", filename: shared },
    {
      code: "const x = <button>Not yet adopted</button>;",
      filename: feature,
      options: [{ slices: ["dossier"] }],
    },
  ],
  invalid: [
    { code: "const x = <button>Go</button>;", filename: feature, errors: [{ messageId: "raw" }] },
    { code: "const x = <input value={v} />;", filename: feature, errors: [{ messageId: "raw" }] },
    { code: "const x = <select />;", filename: feature, errors: [{ messageId: "raw" }] },
    { code: "const x = <table />;", filename: feature, errors: [{ messageId: "raw" }] },
    {
      code: "const x = <input type={kind} />;",
      filename: feature,
      errors: [{ messageId: "raw" }],
    },
  ],
});
