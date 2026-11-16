import type { TaskRunRepo } from "@/shared/contracts/task-run-repo";

/** Used when the backend has no SQL database: reproduces the old dbConfigured() early returns. */
export const nullTaskRunRepo: TaskRunRepo = {
  async prune() {},
  async begin() {
    return undefined;
  },
  async finish() {},
  async recent() {
    return [];
  },
};
