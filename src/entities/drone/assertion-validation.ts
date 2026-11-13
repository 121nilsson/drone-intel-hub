import type {
  AssertionEntity,
  AssertionFrame,
  EntityRole,
  FrameValidationStatus,
} from "./assertion-frame";

/**
 * Structural checks on one assertion frame. Pure: no network, no model, no catalogue. A frame
 * that a check cannot decide is "uncertain", never "pass": the validator only passes what it can
 * show is internally consistent.
 *
 * Why these rules: the costly errors are attribution errors, a value that belongs to one
 * participant landing on another. Patriot's figure must not move to Bars because Bars is the
 * sentence's subject. The rules below refuse the shapes that make that move possible.
 */

export interface FrameValidation {
  status: FrameValidationStatus;
  reasons: string[];
}

/** Roles that name something other than the actor: a value about them never belongs to the subject. */
const NEVER_THE_SUBJECTS_VALUE: ReadonlySet<EntityRole> = new Set<EntityRole>([
  "target",
  "referenced",
  "location",
]);

/** Entity types that are catalogue entries a competing owner could be drawn from. */
const CATALOGUE_TYPES: ReadonlySet<string> = new Set(["system", "organization"]);

export function validateFrame(frame: AssertionFrame): FrameValidation {
  const fails: string[] = [];
  const unsure: string[] = [];

  const byId = new Map<string, AssertionEntity>();
  for (const p of frame.participants) {
    if (byId.has(p.participantId)) {
      fails.push(`participant id "${p.participantId}" is used more than once`);
    } else {
      byId.set(p.participantId, p);
    }
  }

  if (frame.evidence.trim() === "") fails.push("evidence is empty");
  if (frame.predicate.trim() === "") fails.push("predicate is empty");

  const lookup = (
    field: string,
    id: string | undefined,
    required: boolean,
  ): AssertionEntity | undefined => {
    if (id === undefined) {
      if (required) fails.push(`${field} is missing`);
      return undefined;
    }
    const found = byId.get(id);
    if (!found) fails.push(`${field} "${id}" does not reference a participant`);
    return found;
  };

  const subject = lookup("subjectEntityId", frame.subjectEntityId, true);
  const target = lookup("targetEntityId", frame.targetEntityId, false);
  const context = lookup("contextEntityId", frame.contextEntityId, false);
  const measurement = frame.measurement;
  const owner = measurement
    ? lookup("measurement.ownerParticipantId", measurement.ownerParticipantId, true)
    : undefined;

  // A programme frames an engagement; it does not perform one. A system named as context would
  // let a system's own properties be read as the programme's.
  if (context) {
    if (context.role !== "programme_context") {
      fails.push(
        `context participant "${context.participantId}" has role ${context.role}, not programme_context`,
      );
    }
    if (context.entityType === "system") {
      fails.push(`context participant "${context.participantId}" is a system, not a programme`);
    }
  }

  if (subject?.role === "programme_context") {
    fails.push(
      `programme context "${subject.participantId}" is the subject; a programme does not act`,
    );
  }

  if (measurement && owner) {
    const ownerIsSubject = owner.participantId === frame.subjectEntityId;

    if (ownerIsSubject && NEVER_THE_SUBJECTS_VALUE.has(owner.role)) {
      fails.push(
        `measurement "${measurement.rawKey}" is owned by subject "${owner.participantId}" whose role is ${owner.role}`,
      );
    }

    // What the frame itself contradicts: the measurement is keyed by another participant's name
    // ("patriot.range_km") yet owned by the subject. The key says whose figure it is.
    if (ownerIsSubject) {
      const key = measurement.rawKey.toLowerCase();
      const named = frame.participants.find(
        (p) =>
          p.participantId !== owner.participantId &&
          // The same catalogue entry named twice ("Shahed" and "Shahed-136") is not another owner.
          (p.resolvedId === undefined || p.resolvedId !== owner.resolvedId) &&
          CATALOGUE_TYPES.has(p.entityType) &&
          [p.rawName, p.resolvedId ?? ""].some(
            (n) => n.trim().length >= 3 && key.includes(n.trim().toLowerCase()),
          ),
      );
      if (named)
        fails.push(
          `measurement "${measurement.rawKey}" names "${named.rawName}" but is owned by subject "${owner.participantId}" (catalogue collision)`,
        );
    }

    if (measurement.rawValue === "")
      fails.push(`measurement "${measurement.rawKey}" has an empty value`);

    if (owner.resolution === "ambiguous") {
      unsure.push(
        `measurement owner "${owner.participantId}" matches more than one catalogue entry`,
      );
    }
  }

  if (subject?.resolution === "ambiguous") {
    unsure.push(`subject "${subject.participantId}" matches more than one catalogue entry`);
  }
  if (target?.resolution === "ambiguous") {
    unsure.push(`target "${target.participantId}" matches more than one catalogue entry`);
  }

  const reasons = [...fails, ...unsure];
  const status: FrameValidationStatus =
    fails.length > 0 ? "fail" : unsure.length > 0 ? "uncertain" : "pass";
  return { status, reasons };
}

/** Each frame with its validation filled in. Returns new objects; the input is not changed. */
export function validateFrames(frames: readonly AssertionFrame[]): AssertionFrame[] {
  return frames.map((frame) => {
    const v = validateFrame(frame);
    return { ...frame, validationStatus: v.status, reasons: v.reasons };
  });
}
