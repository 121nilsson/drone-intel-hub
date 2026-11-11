/**
 * The on/off switches of the autonomous loops, one definition each. Every loop asks
 * `autonomySwitchEnabled(name)` rather than reading its environment variable itself, so the
 * reading rule is the same everywhere: a switch is on unless its variable is "off", ignoring case
 * and surrounding spaces. An unset or empty variable keeps the default, which is on.
 *
 * Why one rule: the three loops used to read their variables differently (one case-sensitive,
 * one not), so the same "off" could disable one loop and silently leave another running.
 *
 * Names are the keys the scheduled-task list refers to (`ScheduledTask.switch`), so the job
 * table and the code cannot drift apart without a test failing.
 */
export const AUTONOMY_SWITCHES = {
  rules_autopromote: {
    env: "RULES_AUTOPROMOTE",
    default: true,
    description:
      "Lets a sandboxed rule that meets the promotion bar become active without an analyst. Off keeps every rule in shadow.",
  },
  autocorrect: {
    env: "AUTOCORRECT",
    default: true,
    description:
      "Lets unit slips and impossible figures be applied to the catalogue once analysts have earned that trust. Off keeps every finding a proposal.",
  },
  rule_probation: {
    env: "RULE_PROBATION",
    default: true,
    description:
      "Returns a quarantined generated rule to shadow after seven days, so it can earn promotion again. Off leaves every quarantine in place until an analyst acts.",
  },
  rule_replay: {
    env: "RULE_REPLAY",
    default: true,
    description:
      "Hands the posts a quarantined rule shaped back to the pipeline, to be read again without it. Off leaves those posts' claims in place until an analyst or a later re-analysis changes them.",
  },
  ai_verifier: {
    env: "AI_VERIFIER",
    default: true,
    description:
      "Runs the second reader that checks the claims the deterministic checks left uncertain. Off stops it; it changes no claim's state either way.",
  },
} as const;

export type AutonomySwitchName = keyof typeof AUTONOMY_SWITCHES;

export const AUTONOMY_SWITCH_NAMES = Object.keys(AUTONOMY_SWITCHES) as AutonomySwitchName[];

/** Whether the named loop switch is on, read from its environment variable at call time. */
export function autonomySwitchEnabled(name: AutonomySwitchName): boolean {
  const definition = AUTONOMY_SWITCHES[name];
  const raw = process.env[definition.env];
  if (raw === undefined || raw.trim() === "") return definition.default;
  return raw.trim().toLowerCase() !== "off";
}
