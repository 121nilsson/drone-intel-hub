import { cleanReading } from "@/entities/drone/claim-reading";
import { readerOpposes } from "@/entities/drone/entailment-verdict";
import {
  ENTAILMENT_VERSION,
  entailmentPrompt,
  entailmentQuestion,
  independentReader,
  readEntailmentReply,
} from "@/entities/drone/entailment";
import {
  alteredControlValue,
  controlCandidates,
  controlStrata,
  summarizeControls,
  type ControlCandidate,
} from "@/entities/drone/verifier-controls";
import type { VerifierControlRun, VerifierControlsStatus } from "@/shared/contracts/verification";
import { parseModelJson } from "@/shared/infra/model-json";
import { autonomySwitchEnabled } from "@/shared/infra/autonomy/switches.server";
import { recordAutonomyEvent } from "@/shared/infra/autonomy/ledger.server";
import { serverServices } from "@/shared/infra/server-services.server";
import { LocalDroneRepository } from "@/shared/infra/storage/local-repository";
import {
  CEILING,
  CHARS_PER_TOKEN,
  OUTPUT_RESERVE,
  ask,
  readerOptions,
  recordUsage,
  usedToday,
} from "@/shared/infra/verification/entailment.server";

/**
 * The verifier controls (migrations/025): the second reader is shown claims that are wrong by
 * construction - a verified claim whose figure was changed to one its post does not contain - and
 * the answers are stored. A "supported" on one is a false support, so the reader's error rate is
 * measured without a person.
 *
 * Measured only. Nothing here writes to the catalogue, and nothing here reads the audit seed set
 * (verification_audit). The reader, its prompt, its provider order and its daily ceiling are the
 * second reader's own (entailment.server.ts), so a control costs what a real question costs.
 */

/** Controls asked per hourly run: few enough that the ceiling is shared with the reader. */
const CONTROLS_PER_RUN = 10;

/** A candidate with its post and the altered reading the reader will be asked about. */
interface ControlPick extends ControlCandidate {
  post: { id: string; text: string };
  altered: string;
}

/**
 * One hourly run: up to CONTROLS_PER_RUN controls, one per post, newest posts first. Returns at
 * once, with the reason, when the switch is off or there is no database.
 */
export async function runVerifierControls(): Promise<VerifierControlRun> {
  const empty = { asked: 0, supported: 0, unsupported: 0, uncertain: 0 };
  const tokens = { input: 0, output: 0 };
  const { backend, verification } = serverServices();
  if (!backend.capabilities.sql)
    return { ran: false, reason: "no database configured", ...empty, tokens };
  if (!autonomySwitchEnabled("ai_verifier"))
    return { ran: false, reason: "AI_VERIFIER=off", ...empty, tokens };
  const options = readerOptions();
  if (!options.length) return { ran: false, reason: "no AI provider configured", ...empty, tokens };

  const drones = new LocalDroneRepository();
  await drones.attach(await backend.documents());
  const asked = new Set(await verification.askedClaimIds(ENTAILMENT_VERSION));

  // The language of a candidate reads its post, so the posts are loaded first: once to find the
  // posts the candidates come from, then the candidates again with those texts in hand.
  const all = drones.list();
  const sourceIds = [...new Set(controlCandidates(all, asked).map((c) => c.claim.sourceId))];
  const posts = new Map(
    sourceIds.length
      ? (await verification.postTexts(sourceIds)).flatMap((r) =>
          r.text ? [[r.id, { text: r.text, at: +r.created_at }] as const] : [],
        )
      : [],
  );
  const candidates = controlCandidates(
    all,
    asked,
    new Map([...posts].map(([id, p]) => [id, p.text])),
  ).filter((c) => posts.has(c.claim.sourceId));

  // At most one control per post, newest post first; a claim whose altered figure cannot be
  // built is skipped for the next claim of its post.
  const byPost = new Map<string, ControlCandidate[]>();
  for (const c of candidates)
    byPost.set(c.claim.sourceId, [...(byPost.get(c.claim.sourceId) ?? []), c]);
  const picks: ControlPick[] = [];
  for (const postId of [...byPost.keys()].sort((a, b) => posts.get(b)!.at - posts.get(a)!.at)) {
    if (picks.length >= CONTROLS_PER_RUN) break;
    const post = posts.get(postId)!;
    for (const c of byPost.get(postId)!) {
      const altered = alteredControlValue(c.spec, c.claim, post.text);
      if (!altered) continue;
      picks.push({ ...c, post: { id: postId, text: post.text }, altered });
      break;
    }
  }

  const counts = { asked: 0, supported: 0, unsupported: 0, uncertain: 0 };
  // Picks every reader failed on: nothing is stored for them, and the run says how many.
  let noAnswer = 0;
  let stop = "";
  try {
    for (const pick of picks) {
      // The same question a real one is: only the value is the altered reading.
      const question = entailmentQuestion("1", pick.drone, pick.spec, pick.claim, pick.altered);
      const { system, prompt, truncated } = entailmentPrompt(pick.post.text, [question]);
      const estimate = Math.ceil((system.length + prompt.length) / CHARS_PER_TOKEN);
      const used = await usedToday();
      if (used.input + estimate > CEILING.input || used.output + OUTPUT_RESERVE > CEILING.output) {
        stop = `daily token ceiling reached (${used.input} input, ${used.output} output today)`;
        break;
      }
      // A failed reader moves the control to the next independent one, never to a model that
      // extracted the claim - the same rule as the second reader.
      const extractors = new Set(pick.claim.model ? [pick.claim.model] : []);
      let remaining = options;
      let answered = false;
      for (;;) {
        const reader = independentReader(remaining, extractors);
        if (!reader) break;
        remaining = remaining.filter((o) => o !== reader);
        const res = await ask(reader, system, prompt);
        if (!res.ok) {
          if (!res.outage) {
            await recordUsage("controls", { input: estimate, output: 0 });
            tokens.input += estimate;
          }
          continue;
        }
        const spent = res.usage ?? {
          input: estimate,
          output: Math.ceil(res.content.length / CHARS_PER_TOKEN),
        };
        await recordUsage("controls", spent);
        tokens.input += spent.input;
        tokens.output += spent.output;
        const answer = readEntailmentReply(
          parseModelJson(res.content),
          ["1"],
          pick.post.text,
          truncated,
        ).get("1")!;
        await verification.recordControl({
          claimId: pick.claim.id,
          droneId: pick.drone.id,
          specKey: pick.spec.key,
          family: pick.family,
          language: pick.language,
          sourceId: pick.post.id,
          trueValue: cleanReading(pick.spec, pick.claim),
          alteredValue: pick.altered,
          verdict: answer.verdict,
          span: answer.span ?? null,
          provider: reader.provider,
          model: reader.model,
          entailmentVersion: ENTAILMENT_VERSION,
        });
        counts.asked++;
        counts[
          answer.verdict === "supported"
            ? "supported"
            : readerOpposes(answer.verdict)
              ? "unsupported"
              : "uncertain"
        ]++;
        answered = true;
        break;
      }
      if (!answered) noAnswer++;
    }
  } finally {
    // Whatever stopped the loop, the controls already answered are on the record.
    if (counts.asked)
      await recordAutonomyEvent({
        action: "verifier_control_run",
        actor: "verifier-controls",
        actorKind: "verifier",
        targetCollection: "verifier_controls",
        targetId: "run",
        after: { ...counts },
        reversible: false,
      });
  }

  const base = stop || (picks.length ? "asked every control due" : "no claim to control");
  return {
    ran: true,
    reason: picks.length
      ? `${base}; asked ${counts.asked}, ${noAnswer} had no reader answer`
      : base,
    ...counts,
    tokens,
  };
}

/** The controls' record for the current entailment version: overall and per stratum. */
export async function verifierControlsStatus(): Promise<VerifierControlsStatus> {
  // Without a database the repository has no controls to report.
  const rows = await serverServices().verification.controlVerdicts(ENTAILMENT_VERSION);
  return { summary: summarizeControls(rows), strata: controlStrata(rows) };
}
