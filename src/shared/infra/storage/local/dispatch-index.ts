import type { RawDispatch } from "@/entities/dispatch/types";
import { simHash64 } from "@/entities/dispatch/simhash";
import { canonicalUrl } from "@/entities/dispatch/url-key";

/**
 * The two dispatch indexes behind dedupe, owned together because they must be dropped together.
 *
 * Near-duplicate index: a dispatch's text is fingerprinted the first time it is looked at, so
 * documents stored before the fingerprint column existed need no backfill, and the check stays
 * a memory lookup rather than a query against every store.
 *
 * In-memory is enough because the repository already holds the working set (the stores cap the
 * dispatches they return), and because the cache is refreshed on attach(), which is where a
 * stale index would otherwise survive.
 *
 * Canonical-URL index, the deterministic half of dedupe. SimHash answers "are these the same
 * story?" by comparing text, which is the right question for a reprint but the wrong one for the
 * same article arriving from two feeds: those copies can differ in length and wording, and the
 * near-match tolerance decides it by luck. A shared URL is identity, not resemblance, so it gets
 * its own exact index.
 *
 * Keyed on `canonicalUrl` (see entities/dispatch/url-key.ts). Only documents that still carry a
 * URL are indexed; a stub has its text stripped but keeps its URL, which is the point - a
 * duplicate stub must keep pointing at the same article so a third copy resolves to the
 * canonical post rather than to another stub.
 */
export class DispatchIndex {
  private fingerprints = new Map<string, string>();
  private fingerprintIds = new Map<string, string>();
  private urlKeys = new Map<string, string>();
  private urlKeyIds = new Map<string, string>();

  /**
   * Fingerprint a document and index it. Stubs are skipped on purpose: an `irrelevant` dispatch has
   * its text stripped (auto-ingest) and a `duplicate` row has no text at all, so indexing one would
   * let an exact match resolve to the stub instead of the canonical post behind it.
   */
  fingerprint(d: RawDispatch): string | null {
    if (!d.text) return null;
    const fp = d.contentHash ?? simHash64(d.text);
    this.fingerprints.set(fp, d.id);
    this.fingerprintIds.set(d.id, fp);
    return fp;
  }

  /**
   * Index a document's canonical URL. Unlike the text fingerprint this keeps stubs: a `duplicate`
   * row has no text but does carry the URL of the article it points at, and re-indexing it is what
   * makes a third copy resolve to the canonical post rather than to a stub. `duplicateOfUrl`
   * therefore resolves through a stub to whatever the stub duplicates.
   */
  indexUrl(d: RawDispatch): string | null {
    const key = canonicalUrl(d.url);
    if (!key) return null;
    this.urlKeys.set(key, d.id);
    this.urlKeyIds.set(d.id, key);
    return key;
  }

  /** Drop both index entries a document holds. Re-registration is the caller's job. */
  forget(id: string) {
    const key = this.urlKeyIds.get(id);
    if (key !== undefined) {
      this.urlKeyIds.delete(id);
      // Only drop the key if this document is still the one holding it, so two documents
      // sharing a URL cannot leave the index pointing at the one being forgotten.
      if (this.urlKeys.get(key) === id) this.urlKeys.delete(key);
    }
    const fp = this.fingerprintIds.get(id);
    if (fp === undefined) return;
    this.fingerprintIds.delete(id);
    this.fingerprints.delete(fp);
  }

  /** Rebuilt lazily against a new working set rather than trusted across an attach(). */
  clear() {
    this.fingerprints.clear();
    this.fingerprintIds.clear();
    this.urlKeys.clear();
    this.urlKeyIds.clear();
  }

  /** The id indexed under this exact fingerprint, if any. */
  holderOfFingerprint(fingerprint: string): string | undefined {
    return this.fingerprints.get(fingerprint);
  }

  /** The id indexed under this canonical URL key, if any. */
  holderOfUrl(key: string): string | undefined {
    return this.urlKeys.get(key);
  }
}
