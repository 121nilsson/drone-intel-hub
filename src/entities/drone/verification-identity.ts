import { catalogNames } from "./catalog-names";
import { mentionsName } from "./name-key";
import type { Drone, SpecClaim, VerificationCheck } from "./types";
import { check } from "./verification-check";
import { evidencePassagesWithContext, fold } from "./verification-evidence";

/** A name distinctive enough to contradict this claim when it, and not the drone, is named. */
const distinctive = (name: string) => name.trim().length >= 4 || /\d/.test(name);

/**
 * Words that open a sentence about the system named just before it. Matched at the start of the
 * passage, on a token boundary, so "item" and "itself" do not count; the hyphen is excluded too,
 * so "it-136" is a name, not a pronoun.
 */
const CONTINUATION =
  /^(?:it|its|it's|this|the drone|the uav|the missile|the system|він|вона|воно|цей|ця|його|її|он|она|оно|этот|эта|его|её|ее)(?![\p{L}\p{N}_-])/u;

type Naming = { own: boolean; other?: Drone };

/**
 * Catalog systems a passage names by a distinctive name, per catalog and passage. The same
 * sentence or post is checked for every claim it carries, often across several systems, and the
 * scan over the whole catalog is the verifier's dominant cost. Bounded, since passages are
 * unique per post; the catalog key lets a changed catalog start fresh.
 */
const scans = new WeakMap<readonly Drone[], Map<string, Drone[]>>();
const MAX_SCANS = 5000;

function distinctivelyNamed(passage: string, catalog: readonly Drone[]): Drone[] {
  let byPassage = scans.get(catalog);
  if (!byPassage) scans.set(catalog, (byPassage = new Map()));
  const hit = byPassage.get(passage);
  if (hit) return hit;
  const found = catalog.filter((d) =>
    catalogNames(d).some((name) => distinctive(name) && mentionsName(passage, name)),
  );
  if (byPassage.size >= MAX_SCANS) byPassage.clear();
  byPassage.set(passage, found);
  return found;
}

/** Whether a passage names this system, and which other distinctive catalog system it names. */
function naming(passage: string, drone: Drone, catalog: readonly Drone[]): Naming {
  const own = catalogNames(drone).some((name) => mentionsName(passage, name));
  const other = distinctivelyNamed(passage, catalog).find((d) => d.id !== drone.id);
  return other ? { own, other } : { own };
}

/**
 * Does the passage this figure came from name the system it is filed under (plan §4.6)?
 *
 * Anchored to the evidence sentence, not the post: in a post about several systems the drone's
 * own name appears somewhere almost by definition, so a whole-post match would pass exactly the
 * misattribution this check exists to catch. When the sentence names no system the verdict is
 * uncertain - including for a post about one system only, since such a post can still carry a
 * sentence about something it never names. Uncertain is applicable, so it keeps the claim from
 * reading as verified; that lowers the verified share, and the lower number is the honest one.
 *
 * The one exception is an "It ..." sentence, which is about the system the sentence before it
 * names: that earns a pass when the sentence before names this system and no other.
 */
export function identityCheck(
  drone: Drone,
  claim: SpecClaim,
  text: string | undefined,
  catalog: readonly Drone[],
  at: string,
): VerificationCheck {
  const quote = claim.evidence?.trim() || claim.raw?.trim() || "";
  const sourceId = claim.sourceId ? { sourceId: claim.sourceId } : {};
  // Without the post, the quote is the only passage there is; a bare fragment then names nothing,
  // and the evidence check has already made the claim uncertain for want of a source.
  const found = text
    ? evidencePassagesWithContext(text, quote)
    : quote
      ? [{ passage: fold(quote) }]
      : [];
  const passages = found.map((p) => p.passage);
  if (!passages.length && !text)
    return check({
      kind: "identity",
      verdict: "uncertain",
      applicable: false,
      detail: "no evidence text to check identity against",
      at,
    });

  // A sentence that names this system and another ("Unlike the Shahed-136, the Lancet-3 has a
  // range of 40 km") is ambiguous, not a pass: which of the two the figure belongs to is the
  // interpretation the AI judge exists for (plan §4.3 step 5).
  const named = passages.map((p) => naming(p, drone, catalog));
  const own = named.some((n) => n.own);
  const other = named.find((n) => n.other)?.other;
  const evidence = passages.join(" … ");
  if (own && !other)
    return check({
      kind: "identity",
      verdict: "pass",
      applicable: true,
      confidence: 0.8,
      detail: "the evidence sentence names this system",
      evidence,
      ...sourceId,
      at,
    });
  if (other && !own)
    return check({
      kind: "identity",
      verdict: "fail",
      applicable: true,
      confidence: 0.7,
      detail: `the evidence sentence names ${other.name}, not ${drone.name}`,
      evidence,
      ...sourceId,
      at,
    });
  if (own && other)
    return check({
      kind: "identity",
      verdict: "uncertain",
      applicable: true,
      confidence: 0.3,
      detail: `the evidence names both ${drone.name} and ${other.name}`,
      evidence,
      ...sourceId,
      at,
    });

  // The sentence names no system. An "It ..." sentence is about the system the sentence before it
  // names, so that sentence decides it, and only when it names this system and no other. Every
  // passage must be such a sentence: one that is not would be left out of the verdict.
  const continued = found.flatMap((p) =>
    p.before !== undefined && CONTINUATION.test(p.passage) ? [p.before] : [],
  );
  const prior = continued.map((s) => naming(s, drone, catalog));
  if (found.length && continued.length === found.length && prior.every((n) => n.own && !n.other))
    return check({
      kind: "identity",
      verdict: "pass",
      applicable: true,
      confidence: 0.6,
      detail: "the sentence before names this system and this one continues it",
      evidence,
      ...sourceId,
      at,
    });

  // Still uncertain, never a pass: the sentence before may name another system.
  const priorOther = prior.find((n) => n.other)?.other;
  const priorOwn = prior.some((n) => n.own);
  const post: Naming = text ? naming(fold(text), drone, catalog) : { own: false };
  return check({
    kind: "identity",
    verdict: "uncertain",
    applicable: true,
    confidence: post.own ? 0.5 : 0.2,
    detail: priorOther
      ? `the evidence sentence names no system; the sentence before it names ${
          priorOwn ? `${drone.name} and ${priorOther.name}` : priorOther.name
        }`
      : post.own
        ? "the evidence sentence names no system; the post names this one"
        : post.other
          ? `the evidence sentence names no system; the post names ${post.other.name}`
          : "the evidence sentence names no system",
    ...(evidence ? { evidence } : {}),
    ...sourceId,
    at,
  });
}
