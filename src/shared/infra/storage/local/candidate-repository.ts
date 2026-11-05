import type { Candidate } from "@/entities/drone/types";
import type { CandidateRepository } from "@/shared/contracts/repository";
import { CachedRepository } from "./cached-repository";

export class LocalCandidateRepository
  extends CachedRepository<"candidates">
  implements CandidateRepository
{
  constructor() {
    super("candidates", []);
  }
  add(c: Candidate) {
    this.items = [c, ...this.items];
    this.save(c);
  }
  update(id: string, patch: Partial<Candidate>) {
    this.items = this.items.map((c) => (c.id === id ? { ...c, ...patch } : c));
    const doc = this.items.find((c) => c.id === id);
    if (doc) this.save(doc, (fresh) => ({ ...fresh, ...patch }));
  }
  remove(id: string) {
    this.items = this.items.filter((c) => c.id !== id);
    this.drop(id);
  }
}
