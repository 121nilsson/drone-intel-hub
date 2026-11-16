import type { StorageBackend } from "@/shared/contracts/backend";
import { nullRulesRepo } from "@/shared/infra/null-repos/rules";
import type { RulesRepo } from "@/shared/contracts/rules-repo";
import type { ServerServices } from "@/shared/infra/server-services.server";

/** One call the domain made on the fake: the method and its arguments. */
export interface RepoCall {
  method: string;
  args: unknown[];
}

/**
 * An in-memory RulesRepo for tests: every method records its call and returns what the test put in
 * `answers` (the null adapter's answer when nothing is set), so a domain flow can be driven
 * without a database and its repository calls asserted in order.
 */
export function fakeRulesRepo(answers: Partial<Record<keyof RulesRepo, unknown>> = {}) {
  const calls: RepoCall[] = [];
  const repo = new Proxy({} as RulesRepo, {
    get(_target, prop: string) {
      if (!(prop in nullRulesRepo)) return undefined;
      return async (...args: unknown[]) => {
        calls.push({ method: prop, args });
        if (prop in answers) {
          const answer = answers[prop as keyof RulesRepo];
          return typeof answer === "function"
            ? (answer as (...a: unknown[]) => unknown)(...args)
            : answer;
        }
        if (prop === "withActivationLock") return (args[0] as () => Promise<unknown>)();
        return (nullRulesRepo[prop as keyof RulesRepo] as (...a: unknown[]) => unknown)(...args);
      };
    },
  });
  return {
    repo,
    calls,
    names: () => calls.map((c) => c.method),
    callsOf: (method: string) => calls.filter((c) => c.method === method),
  };
}

/** A backend that has SQL, with an empty document store, so the SQL-guarded loops run. */
export function fakeSqlBackend(): StorageBackend {
  return {
    kind: "postgres",
    capabilities: { revisions: true, sql: true },
    serverStorage: true,
    documents: async () =>
      ({ load: async () => [], loadPage: async () => ({ items: [], next: null }) }) as never,
    archiveCounts: async () => null,
  };
}

export function fakeServices(repo: RulesRepo): Partial<ServerServices> {
  return { backend: fakeSqlBackend(), rules: repo };
}
