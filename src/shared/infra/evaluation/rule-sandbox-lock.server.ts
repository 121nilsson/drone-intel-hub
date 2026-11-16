import { ACTIVATION_LOCK } from "@/shared/contracts/rules-repo";
import { rulesRepo } from "@/shared/infra/evaluation/rule-sandbox-store.server";

/** Serializes activations across processes (web, tasks): see withActivationLock. */
export { ACTIVATION_LOCK };

/**
 * Two activations sandboxed at once would each be checked against a rule set without the
 * other, so a pair that only breaks in combination would go live and wait for the nightly
 * breaker. The repository holds a session advisory lock on a reserved connection around `fn`, so
 * each activation sees every one before it; the lock dies with the connection if the process does.
 */
export async function withActivationLock<T>(
  fn: () => Promise<T>,
): Promise<T | { ok: false; reason: string }> {
  return rulesRepo().withActivationLock(fn);
}
