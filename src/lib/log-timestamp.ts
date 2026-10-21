/**
 * Every log line the app writes carries a timestamp.
 *
 * Docker prefixes each line with the service name but not the time, so a run of proxy and
 * pipeline lines reads as one wall of text with no way to tell what happened first. The
 * timestamp goes first, before the line's own tag, so the lines stay sortable and greppable -
 * and it is the same clock the database's own log records.
 *
 * The wrapper is global on purpose: the app logs from the pipeline, the proxy, the sync and the
 * framework, and a helper that each of them has to remember to call is a helper one of them
 * will forget. `src/lib/error-capture.ts` already wraps `console.error` the same way.
 */
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/;

/** The line's own arguments, with a timestamp in front unless it already carries one. */
function stamped(args: unknown[]): unknown[] {
  const first = args[0];
  if (typeof first === "string" && TIMESTAMP.test(first)) return args;
  return [new Date().toISOString(), ...args];
}

/**
 * Prefix every console line with the time. Called once at server start (plugins/log-timestamp.ts),
 * before the migrations and the scheduled jobs write their first line.
 */
export function stampLogLines(): void {
  const originalLog = console.log.bind(console);
  console.log = (...args: unknown[]) => originalLog(...stamped(args));

  const originalInfo = console.info.bind(console);
  console.info = (...args: unknown[]) => originalInfo(...stamped(args));

  const originalWarn = console.warn.bind(console);
  console.warn = (...args: unknown[]) => originalWarn(...stamped(args));

  const originalError = console.error.bind(console);
  console.error = (...args: unknown[]) => originalError(...stamped(args));
}
