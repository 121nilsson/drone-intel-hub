/**
 * Repo-local ESLint rules.
 *
 * These encode architecture rules that AGENTS.md states in prose but that nothing enforced, so
 * a model (or a person) could break them without noticing:
 *
 * 1. `no-cross-feature-import` - a feature may not import another feature's modules. Code two
 *    slices need belongs in `src/shared/` (shared implementation) or `src/entities/` (pure
 *    domain), or behind a contract in `src/shared/contracts/`.
 *
 * 2. `no-lower-layer-feature-import` - `src/shared/` and `src/entities/` sit below the feature
 *    slices, so they may not reach up into one. A shared module that needs a slice's behaviour
 *    takes it as a parameter or through a contract instead.
 *
 * 3. `no-server-import-from-client` - only a `*.server.ts` or `*.functions.ts` module may import a
 *    `*.server` module, and only by value. A type-only import is erased at build time and stays
 *    allowed, so a shared type may still live next to its implementation.
 *
 * 4. `no-nordic-ui-copy` - UI copy is English. Cyrillic and Greek are deliberately allowed:
 *    the catalog shows Russian and Ukrainian system names verbatim, and those are data, not copy.
 *    A literal that genuinely has to carry a Nordic name gets an inline `eslint-disable-next-line`
 *    stating why.
 *
 * 5. `no-raw-controls` - in every feature slice, buttons, inputs, selects,
 *    textareas and tables come from src/shared/ui, so the look and the mobile behaviour are
 *    defined once instead of re-styled per page.
 *
 * The layer map these rules enforce:
 *
 *   src/entities/        pure domain. Imports nothing outside src/entities.
 *   src/shared/contracts/  interfaces shared by more than one slice.
 *   src/shared/infra/    implementations and shared application services (the ingest pipeline,
 *                        the evaluation engine, storage, AI clients, HTTP sources).
 *   src/shared/ui/       shared presentational widgets.
 *   src/features/<x>/    slice-specific UI and composition.
 *   src/routes/          route components; may import features.
 */

import path from "node:path";

const NORDIC = /[åäöæøÅÄÖÆØ]/;

/** The repo root, derived from this file's own location. */
const ROOT = path.resolve(import.meta.dirname, "..");
const SRC = path.join(ROOT, "src");

/** The feature slice a path belongs to, or undefined when it is not inside a feature. */
function sliceOf(filePath) {
  const rel = path.relative(SRC, filePath);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return undefined;
  const parts = rel.split(path.sep);
  if (parts[0] !== "features" || parts.length < 2) return undefined;
  return parts[1];
}

/** The layer a path belongs to: "feature", "shared", "entities", "routes", "test" or "other". */
function layerOf(filePath) {
  const rel = path.relative(SRC, filePath);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return "other";
  const parts = rel.split(path.sep);
  if (parts[0] === "features") return "feature";
  if (parts[0] === "shared") return "shared";
  if (parts[0] === "entities") return "entities";
  if (parts[0] === "routes") return "routes";
  if (parts[0] === "test") return "test";
  return "other";
}

/**
 * Resolve an import specifier to a path inside the repo, or undefined when it points outside
 * (a bare package specifier). Both "@/..." aliases and relative paths are resolved, so an import
 * that reaches a sibling slice through "../" is caught just like one that uses the alias.
 */
function resolveSource(filePath, source) {
  if (source.startsWith("@/")) return path.join(SRC, source.slice(2));
  if (source.startsWith(".")) return path.resolve(path.dirname(filePath), source);
  return undefined;
}

/** True when the import binds a runtime value rather than only types. */
function bindsValue(node) {
  if (node.importKind === "type") return false;
  const specifiers = node.specifiers || [];
  if (specifiers.length === 0) return false;
  // Only a named specifier can be type-only; a default or namespace import always binds a value.
  return specifiers.some((s) => !(s.type === "ImportSpecifier" && s.importKind === "type"));
}

const noCrossFeatureImport = {
  meta: {
    type: "problem",
    docs: "https://eslint.org/docs/latest/use/configure/rules",
    schema: [],
    messages: {
      crossFeature:
        'Feature "{{from}}" must not import "{{to}}" ({{source}}). Code two slices need belongs in src/shared/ (shared implementation) or src/entities/ (pure domain), or behind a contract in src/shared/contracts/.',
    },
  },
  create(context) {
    const from = sliceOf(context.filename);
    if (!from) return {};
    return {
      ImportDeclaration(node) {
        const source = node.source.value;
        if (typeof source !== "string") return;
        const resolved = resolveSource(context.filename, source);
        if (!resolved) return;
        const to = sliceOf(resolved);
        if (!to || to === from) return;
        context.report({
          node: node.source,
          messageId: "crossFeature",
          data: { from, to, source },
        });
      },
    };
  },
};

const noLowerLayerFeatureImport = {
  meta: {
    type: "problem",
    docs: "https://eslint.org/docs/latest/use/configure/rules",
    schema: [],
    messages: {
      lowerLayer:
        'src/{{layer}} is below the feature slices and must not import "{{source}}". Take the behaviour as a parameter or through a contract in src/shared/contracts/ instead.',
    },
  },
  create(context) {
    const layer = layerOf(context.filename);
    if (layer !== "shared" && layer !== "entities") return {};
    return {
      ImportDeclaration(node) {
        const source = node.source.value;
        if (typeof source !== "string") return;
        const resolved = resolveSource(context.filename, source);
        if (!resolved) return;
        if (!sliceOf(resolved)) return;
        context.report({
          node: node.source,
          messageId: "lowerLayer",
          data: { layer, source },
        });
      },
    };
  },
};

const noServerImportFromClient = {
  meta: {
    type: "problem",
    docs: "https://eslint.org/docs/latest/use/configure/rules",
    schema: [],
    messages: {
      serverImport:
        "Only a *.server.ts or *.functions.ts module may import {{source}} by value. The server module would be pulled into the browser bundle.",
    },
  },
  create(context) {
    const filename = context.filename;
    if (/\.(server|functions)\.ts$/.test(filename)) return {};
    // Tests, the Nitro task runner and Nitro plugins are server-side by construction.
    const layer = layerOf(filename);
    if (layer === "test") return {};
    const rel = path.relative(ROOT, filename);
    if (rel.split(path.sep)[0] === "tasks" || rel.split(path.sep)[0] === "plugins") return {};
    return {
      ImportDeclaration(node) {
        const source = node.source.value;
        if (typeof source !== "string") return;
        if (!/\.server(\/|$)/.test(source)) return;
        if (!bindsValue(node)) return;
        context.report({ node: node.source, messageId: "serverImport", data: { source } });
      },
    };
  },
};

const noNordicUiCopy = {
  meta: {
    type: "problem",
    docs: "https://eslint.org/docs/latest/use/configure/rules",
    schema: [],
    messages: {
      nordic:
        "UI copy must be English, but this string contains Nordic characters ({{text}}). Names in other languages are data and belong in the catalog, not in a UI string. If a literal really must carry a Nordic name, add an inline eslint-disable-next-line with the reason.",
    },
  },
  create(context) {
    // Only the layers that author user-visible copy. `src/entities`, `src/shared/contracts` and
    // `src/shared/lexicons` hold vocabulary and schemas, where a foreign word is data, not copy,
    // and `src/test` holds fixtures.
    const rel = path.relative(SRC, context.filename);
    if (rel.startsWith("..") || path.isAbsolute(rel)) return {};
    const parts = rel.split(path.sep);
    const top = parts[0];
    const inScope =
      top === "features" ||
      top === "routes" ||
      (top === "shared" && (parts[1] === "ui" || parts[1] === "infra"));
    if (!inScope) return {};

    function report(node, value) {
      if (typeof value !== "string") return;
      const match = NORDIC.exec(value);
      if (!match) return;
      context.report({ node, messageId: "nordic", data: { text: match[0] } });
    }
    return {
      Literal(node) {
        report(node, node.value);
      },
      TemplateElement(node) {
        report(node, node.value.raw);
      },
      JSXText(node) {
        report(node, node.value);
      },
    };
  },
};

/** Elements a migrated slice takes from src/shared/ui instead of styling by hand. */
const RAW_CONTROLS = {
  button: "Btn, Callout, FilterChip or Segmented",
  input: "Input or SearchInput",
  select: "Select",
  textarea: "Textarea",
  table: "DataTable",
};

const NON_TEXT_INPUT = new Set(["checkbox", "radio", "range", "file", "hidden", "color"]);

/** The literal `type` of a JSX element, or undefined when it is absent or computed. */
function staticType(node) {
  const attr = node.attributes.find((a) => a.type === "JSXAttribute" && a.name.name === "type");
  return attr?.value?.type === "Literal" ? attr.value.value : undefined;
}

const noRawControls = {
  meta: {
    type: "problem",
    docs: "https://eslint.org/docs/latest/use/configure/rules",
    schema: [
      { type: "object", properties: { slices: { type: "array", items: { type: "string" } } } },
    ],
    messages: {
      raw: "Use {{instead}} from src/shared/ui instead of a hand-styled <{{tag}}>: the shared component owns the look, the touch size and the mobile layout, so a fix lands once.",
    },
  },
  create(context) {
    // Every slice by default; `slices` narrows it, for adopting the rule one slice at a time.
    const slices = context.options[0]?.slices;
    const slice = sliceOf(context.filename);
    if (!slice || (slices && !slices.includes(slice))) return {};
    return {
      JSXOpeningElement(node) {
        if (node.name.type !== "JSXIdentifier") return;
        const instead = RAW_CONTROLS[node.name.name];
        // A checkbox, radio, slider or file picker is not a text field; Input does not style them.
        if (node.name.name === "input" && NON_TEXT_INPUT.has(staticType(node))) return;
        if (instead)
          context.report({ node, messageId: "raw", data: { tag: node.name.name, instead } });
      },
    };
  },
};

export default {
  rules: {
    "no-raw-controls": noRawControls,
    "no-cross-feature-import": noCrossFeatureImport,
    "no-lower-layer-feature-import": noLowerLayerFeatureImport,
    "no-server-import-from-client": noServerImportFromClient,
    "no-nordic-ui-copy": noNordicUiCopy,
  },
};
