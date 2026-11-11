// Shared number formatting for the evaluation and autonomy pages.
// Whole percent is the default: scores, agreement and coverage read at a glance.
export const pct = (n: number) => `${Math.round(n * 100)}%`;

// One decimal, for error bounds where a whole percent would hide the gap between
// the budget and the measured rate (audit page). A different rounding on purpose.
export const pctPrecise = (n: number) => `${(n * 100).toFixed(1)}%`;

// A stored ISO timestamp read to the minute, in the same shape the autonomy ledger shows: "2026-11-11 21:20".
export const dateTime = (iso: string) => iso.slice(0, 16).replace("T", " ");
