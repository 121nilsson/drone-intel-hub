/**
 * Flag parsing shared by the semantic-eval scripts (review findings Q4, T3, T4). Pure: it never
 * exits or prints; the script turns an error into exit 2.
 *
 * A flag that is absent takes its default. A flag that is present must be followed by a value: a
 * missing value, an empty one, or the next flag in its place is an error, never a path. Scripts
 * read every value flag once, at startup, before anything is written (T4).
 */

export type FlagValues<K extends string> =
  | { readonly ok: true; readonly values: Readonly<Record<K, string>> }
  | { readonly ok: false; readonly reason: string };

/** Reads each flag in `defaults` from `args`; the first invalid flag is the error. */
export function readFlags<K extends string>(
  args: readonly string[],
  defaults: Readonly<Record<K, string>>,
): FlagValues<K> {
  const values = {} as Record<K, string>;
  for (const flag of Object.keys(defaults) as K[]) {
    const i = args.indexOf(flag);
    if (i < 0) {
      values[flag] = defaults[flag];
      continue;
    }
    const v = args[i + 1];
    if (v === undefined || v.length === 0 || v.startsWith("--")) {
      return { ok: false, reason: `${flag} needs a value` };
    }
    values[flag] = v;
  }
  return { ok: true, values };
}
