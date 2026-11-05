import { parseModelJson } from "@/shared/infra/model-json";
import {
  entailmentPrompt,
  independentReader,
  needsEntailment,
  readEntailmentReply,
  textHash,
  toEntailment,
  type EntailmentQuestion,
  type ReaderOption,
} from "@/entities/drone/entailment";
import { ANALYST_SOURCE } from "@/entities/drone/claim-review";
import { catalogNames } from "@/entities/drone/catalog-names";
import type { ClaimEntailment, Drone, SpecAttribute, SpecClaim } from "@/entities/drone/types";
import { claimReading } from "@/entities/drone/claim-reading";
import type { SecondReaderRun, TokenUsageToday } from "@/shared/contracts/verification";
import { chatCompletionOnce } from "@/shared/infra/ai-proxy.server";
import { getAvailableProviders, getProviderModel } from "@/shared/infra/ai-providers";
import { autonomySwitchEnabled } from "@/shared/infra/autonomy/switches.server";
import { db, dbConfigured } from "@/shared/infra/postgres/db.server";
import { PostgresStore } from "@/shared/infra/postgres/postgres-store.server";
import { LocalDroneRepository } from "@/shared/infra/storage/local-repository";

/**
 * The second reader on the server (plan §4.3, step 5; §9 Phase 2, step 3): for each post, one call
 * to a model that extracted none of its claims, asking which of them the post states.
 *
 * Measured, not acted on. The answers land on `SpecClaim.entailment`; the deterministic state does
 * not change, consensus does not read them, and the audit page compares them with the person's
 * answers on the seed set. Only that measurement can let a later change give them a vote.
 *
 * Which claims: those the deterministic checks left uncertain, which is where a second reader can
 * add something, and every claim a person has audited, which is what the reader is measured on.
 */

/**
 * A positive whole number from the environment, else the default. An empty or malformed value
 * ("", "5M", "abc") must not become 0, which blocks every run, or NaN, which no comparison ever
 * exceeds - a ceiling that is quietly never enforced. Underscores are allowed: 5_000_000.
 */
function positiveFromEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw.replace(/_/g, ""));
  if (Number.isFinite(n) && n > 0) return Math.floor(n);
  console.warn(`[verification:ai] ${name}=${raw} is not a positive number; using ${fallback}`);
  return fallback;
}

/** Plan §14, set by the project owner. Overridable for a self-hosted model with no such cost. */
const CEILING = {
  input: positiveFromEnv("VERIFIER_DAILY_INPUT_TOKENS", 5_000_000),
  output: positiveFromEnv("VERIFIER_DAILY_OUTPUT_TOKENS", 500_000),
};
/** The purposes the ceiling covers: the reader now, the challenger when it exists. */
const BUDGETED = ["verifier", "challenger"];
/** Posts read per run: the backlog spreads over a few hourly runs instead of one long one. */
const POSTS_PER_RUN = positiveFromEnv("VERIFIER_POSTS_PER_RUN", 40);
/** A reasoning model's thinking counts as output, so a call is budgeted at this before it runs. */
const OUTPUT_RESERVE = 2500;
/** Characters per token, for a provider that reports no usage. Conservative for Cyrillic. */
const CHARS_PER_TOKEN = 3;

/**
 * Reader order: VERIFIER_PROVIDERS (comma list), else the readers that answered when this was
 * built first (2026-11-01: NVIDIA's nemotron-super returned 404, deeprelay 403). A provider reads
 * with VERIFIER_<NAME>_MODEL, else its tier-2 model.
 */
function readerOptions(): ReaderOption[] {
  const order = (process.env["VERIFIER_PROVIDERS"] ?? "groq,mistral,nvidia,deeprelay,openrouter")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const available = getAvailableProviders();
  return order.flatMap((name) => {
    const p = available.find((a) => a.name === name);
    if (!p) return [];
    const model =
      process.env[`VERIFIER_${p.name.toUpperCase()}_MODEL`]?.trim() || getProviderModel(p, "tier2");
    return [{ provider: p.name, model }];
  });
}

/**
 * Whether a model may have extracted the claim. A heuristic or reference claim names no model and
 * needs none: no model read it, so any reader is a second one.
 */
const isAiExtracted = (c: SpecClaim) =>
  c.extractionEngine !== "heuristic" && c.extractionEngine !== "reference";

async function usedToday(): Promise<{ input: number; output: number }> {
  const [row] = await db()<{ input: string | null; output: string | null }[]>`
    select sum(input) as input, sum(output) as output from ai_token_usage
     where day = current_date and purpose = any(${BUDGETED})`;
  return { input: Number(row?.input ?? 0), output: Number(row?.output ?? 0) };
}

async function recordUsage(purpose: string, used: { input: number; output: number }) {
  await db()`insert into ai_token_usage (day, purpose, input, output, calls)
    values (current_date, ${purpose}, ${used.input}, ${used.output}, 1)
    on conflict (day, purpose) do update
      set input = ai_token_usage.input + excluded.input,
          output = ai_token_usage.output + excluded.output,
          calls = ai_token_usage.calls + 1`;
}

interface Target {
  drone: Drone;
  claim: SpecClaim & { id: string };
  spec: SpecAttribute;
  attribute: string;
}

const isMachineClaim = (c: SpecClaim) =>
  c.source !== ANALYST_SOURCE && c.extractionEngine !== "analyst";

/** Today's spend against the ceiling, for the Autonomy page. */
export async function tokenUsageToday(): Promise<TokenUsageToday> {
  const used = dbConfigured() ? await usedToday() : { input: 0, output: 0 };
  return { ...used, ceiling: CEILING };
}

/** What one call to one reader came to: an answer, or a reason it gave none. */
type Attempt =
  | { ok: true; content: string; usage?: { input: number; output: number } }
  | { ok: false; outage: boolean };

/**
 * One call, never throwing. A pinned provider is called directly, and that path throws on a bad
 * base URL or a body that stalls; a throw here would end the run and lose every verdict it had
 * already paid for, so it counts as a failed attempt like any other.
 */
async function ask(reader: ReaderOption, system: string, prompt: string): Promise<Attempt> {
  try {
    const res = await chatCompletionOnce({
      provider: reader.provider,
      model: reader.model,
      system,
      prompt,
      json: true,
      tier: "tier2",
    });
    return res.ok
      ? { ok: true, content: res.content, ...(res.usage ? { usage: res.usage } : {}) }
      : { ok: false, outage: res.outage === true };
  } catch (e) {
    console.warn(`[verification:ai] ${reader.provider} threw`, e);
    return { ok: false, outage: false };
  }
}

export async function runEntailment(): Promise<SecondReaderRun> {
  const empty = { posts: 0, claims: 0, supported: 0, unsupported: 0, uncertain: 0, deferred: 0 };
  const tokens = { input: 0, output: 0 };
  if (!dbConfigured()) return { ran: false, reason: "no database configured", ...empty, tokens };
  if (!autonomySwitchEnabled("ai_verifier"))
    return { ran: false, reason: "AI_VERIFIER=off", ...empty, tokens };
  const options = readerOptions();
  if (!options.length) return { ran: false, reason: "no AI provider configured", ...empty, tokens };

  const drones = new LocalDroneRepository();
  await drones.attach(new PostgresStore());
  const sql = db();
  const audited = new Set(
    (
      await sql<{ claim_id: string }[]>`select distinct claim_id from verification_audit
      where role <> 'control'`
    ).map((r) => r.claim_id),
  );

  // Every candidate claim, grouped by the post it came from.
  const byPost = new Map<string, Target[]>();
  for (const drone of drones.list())
    for (const spec of drone.specs)
      for (const claim of spec.claims) {
        if (!claim.id || !claim.sourceId || !isMachineClaim(claim)) continue;
        const wanted = audited.has(claim.id) || claim.verification?.state === "uncertain";
        if (!wanted) continue;
        const list = byPost.get(claim.sourceId) ?? [];
        list.push({
          drone,
          claim: claim as SpecClaim & { id: string },
          spec,
          attribute: spec.label,
        });
        byPost.set(claim.sourceId, list);
      }
  const ids = [...byPost.keys()];
  const posts = new Map(
    ids.length
      ? (
          await sql<{ id: string; text: string | null; created_at: Date }[]>`
            select id, data->>'text' as text, created_at from dispatches where id = any(${ids})`
        ).flatMap((r) => (r.text ? [[r.id, r] as const] : []))
      : [],
  );
  // Only what still needs reading against the post as it stands: audited claims first, because
  // they are what the reader is measured on, then the newest posts.
  const queue = [...byPost.entries()]
    .flatMap(([id, targets]) => {
      const post = posts.get(id);
      if (!post?.text) return [];
      const hash = textHash(post.text);
      const due = targets.filter((t) => needsEntailment(t.claim, hash));
      return due.length ? [{ id, text: post.text, at: +post.created_at, hash, due }] : [];
    })
    .sort(
      (a, b) =>
        Number(b.due.some((t) => audited.has(t.claim.id))) -
          Number(a.due.some((t) => audited.has(t.claim.id))) || b.at - a.at,
    );

  const verdicts = new Map<string, ClaimEntailment>();
  let attempted = 0;
  let stop = "";
  try {
    for (const post of queue) {
      // Attempts count, not answers: a reader returning unusable replies must not turn a capped
      // run into one call per post of the whole backlog.
      if (attempted >= POSTS_PER_RUN) {
        stop = `tried ${POSTS_PER_RUN} posts, the per-run cap`;
        break;
      }
      const questions: EntailmentQuestion[] = post.due.map((t, i) => ({
        ref: String(i + 1),
        system: t.drone.name,
        aliases: catalogNames(t.drone),
        attribute: t.attribute,
        value: claimReading(t.spec, t.claim),
      }));
      const { system, prompt, truncated } = entailmentPrompt(post.text, questions);
      const estimate = Math.ceil((system.length + prompt.length) / CHARS_PER_TOKEN);
      const used = await usedToday();
      if (used.input + estimate > CEILING.input || used.output + OUTPUT_RESERVE > CEILING.output) {
        stop = `daily token ceiling reached (${used.input} input, ${used.output} output today)`;
        break;
      }
      attempted++;
      const extractors = new Set(post.due.flatMap((t) => (t.claim.model ? [t.claim.model] : [])));
      // A failed reader moves the post to the next independent one, never to a model that
      // extracted it.
      let remaining = options;
      for (;;) {
        const reader = independentReader(remaining, extractors);
        if (!reader) break;
        remaining = remaining.filter((o) => o !== reader);
        const res = await ask(reader, system, prompt);
        if (!res.ok) {
          // A refusal (rate limit, auth, outage) cost nothing; any other failure may have been a
          // reply that was paid for and unusable, so the prompt is counted against the ceiling.
          if (!res.outage) {
            await recordUsage("verifier", { input: estimate, output: 0 });
            tokens.input += estimate;
          }
          continue;
        }
        const spent = res.usage ?? {
          input: estimate,
          output: Math.ceil(res.content.length / CHARS_PER_TOKEN),
        };
        await recordUsage("verifier", spent);
        tokens.input += spent.input;
        tokens.output += spent.output;
        const answers = readEntailmentReply(
          parseModelJson(res.content),
          questions.map((q) => q.ref),
          post.text,
          truncated,
        );
        const at = new Date().toISOString();
        post.due.forEach((t, i) => {
          const answer = answers.get(String(i + 1))!;
          const known = !!t.claim.model || !isAiExtracted(t.claim);
          verdicts.set(t.claim.id, toEntailment(answer, reader, post.hash, at, known));
        });
        break;
      }
    }
  } finally {
    // Whatever stopped the loop, the verdicts already paid for are written.
    await writeVerdicts(drones, verdicts);
  }

  const all = [...verdicts.values()];
  const count = (v: ClaimEntailment["verdict"]) => all.filter((e) => e.verdict === v).length;
  const answeredPosts = new Set(
    queue.filter((p) => p.due.some((t) => verdicts.has(t.claim.id))).map((p) => p.id),
  ).size;
  return {
    ran: true,
    reason: stop || (queue.length ? "tried every post that was due" : "nothing due"),
    posts: answeredPosts,
    claims: all.length,
    supported: count("supported"),
    unsupported: count("unsupported"),
    uncertain: count("uncertain"),
    deferred: queue.length - answeredPosts,
    tokens,
  };
}

/**
 * One write per entry, replayed onto the stored copy on a conflict: a verdict lands on the claim
 * it was given for, wherever that claim is now, and nowhere else.
 */
async function writeVerdicts(
  drones: LocalDroneRepository,
  verdicts: ReadonlyMap<string, ClaimEntailment>,
): Promise<void> {
  if (!verdicts.size) return;
  const apply = (d: Drone): Drone => {
    let changed = false;
    const specs = d.specs.map((s) => {
      let specChanged = false;
      const claims = s.claims.map((c) => {
        const v = c.id ? verdicts.get(c.id) : undefined;
        if (!v) return c;
        specChanged = changed = true;
        return { ...c, entailment: v };
      });
      return specChanged ? { ...s, claims } : s;
    });
    return changed ? { ...d, specs } : d;
  };
  const failures: string[] = [];
  const off = drones.onStorageError((m) => failures.push(m));
  try {
    for (const d of drones.list()) {
      const next = apply(d);
      if (next !== d) drones.upsert(next, apply);
    }
    await drones.flush();
  } finally {
    off();
  }
  if (failures.length)
    throw new Error(`${failures.length} write(s) failed: ${failures.slice(0, 3).join("; ")}`);
}
