/**
 * An assertion frame is one relation a sentence states, pinned to the words that state it: the
 * actor (subject), what it acts on (target), the programme or context it happens under, and - when
 * the sentence states a value - the participant that owns that value.
 *
 * Why the owner is a separate field from the subject: "Patriot batteries defended Kyiv" and a
 * figure about Patriot's range in the same post must not end up on Bars just because Bars is the
 * subject of the sentence. The relation's actor and the property's owner are different facts.
 *
 * This file is types only. Nothing here reads a catalogue, a database or a model.
 */

/** What a participant does in the sentence. Set by the producer, checked by the validator. */
export type EntityRole =
  | "subject"
  | "target"
  | "carrier"
  | "subsystem"
  | "actor"
  | "programme_context"
  | "location"
  | "referenced"
  | "launcher"
  | "payload";

export type EntityType =
  "system" | "organization" | "programme" | "location" | "component" | "unknown";

/** How the participant's name was matched to the catalogue, if at all. */
export type EntityResolution = "exact_catalog_match" | "alias_match" | "unresolved" | "ambiguous";

export interface AssertionEntity {
  /** Local to one frame's sentence; the frame refers to participants by this id. */
  participantId: string;
  entityType: EntityType;
  /** The name as the source wrote it, before any matching. */
  rawName: string;
  resolvedId?: string;
  role: EntityRole;
  resolution: EntityResolution;
}

/** A value the sentence states, and the participant it describes. */
export interface AssertionMeasurement {
  /** Who owns the property. Not necessarily the frame's subject. */
  ownerParticipantId: string;
  rawKey: string;
  rawValue: string | number;
  rawUnit?: string;
}

export type FrameValidationStatus = "pass" | "fail" | "uncertain";

export interface AssertionFrame {
  frameId: string;
  /** RawDispatch.id (`${sourceId}|${externalId}`), when the frame came from ingest. */
  sourceId?: string;
  sourceHash: string;
  /** Verbatim quote that carries the assertion; the analyst goes from a hit to the text with it. */
  evidence: string;
  /** Character offsets of `evidence` in the source, when the producer can give them. */
  evidenceSpan?: [number, number];
  sentenceIndex: number;
  predicate: string;
  participants: AssertionEntity[];
  subjectEntityId: string;
  targetEntityId?: string;
  contextEntityId?: string;
  measurement?: AssertionMeasurement;
  validationStatus: FrameValidationStatus;
  reasons?: string[];
}
