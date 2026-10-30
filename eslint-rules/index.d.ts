import type { Rule } from "eslint";

/** Types for the repo-local ESLint plugin, so tests can load a rule and run it. */
declare const plugin: { rules: Record<string, Rule.RuleModule> };
export default plugin;
