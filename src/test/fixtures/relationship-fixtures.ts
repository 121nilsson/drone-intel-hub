/**
 * Frozen relationship fixtures: the sentences the assertion-frame layer must read the same way on
 * every run. Data only; the assertions that use them are switched on per phase (see
 * src/test/relationship-validation.test.ts).
 *
 * Why frozen: a frame that is correct today and silently different tomorrow is the regression we
 * cannot see from aggregate counts. Each fixture names what must NOT come out, because the wrong
 * reading is usually a plausible one.
 *
 * Fixtures with status "awaiting_source_text" are slots. Their source text has not been supplied,
 * so they carry no invented sentence and count as nothing: they are not passing regressions.
 */

import type { AssertionEntity, AssertionFrame } from "@/entities/drone/assertion-frame";

/** The frame as the fixture states it; the id, hash and verdict are produced at run time. */
export type ExpectedFrame = Omit<AssertionFrame, "validationStatus" | "frameId" | "sourceHash">;

export interface ExpectedClaim {
  semantic: string;
  domain: string;
  value: number;
  unit?: string;
  dimension?: string;
  canonicalValue?: number;
  canonicalUnit?: string;
  ownerParticipantId?: string;
}

/** The phase whose change first makes this fixture's assertions binding. */
export type FixtureActivePhase = "phase4" | "phase5" | "phase6";

export interface RelationshipFixture {
  id: string;
  title: string;
  sourceText: string;
  participants: AssertionEntity[];
  expectedFrames: ExpectedFrame[];
  expectedClaims: ExpectedClaim[];
  mustNotProduce: string[];
  activeFrom: FixtureActivePhase;
  status?: "awaiting_source_text";
  /** Why a slot has no text yet, or what it guards; shown next to the id in test output. */
  note?: string;
}

// --- fixture 1: two systems in one sentence, one engagement each -------------------------------

const barsPatriotParticipants: AssertionEntity[] = [
  {
    participantId: "p1",
    entityType: "system",
    rawName: "Bars",
    resolvedId: "drone-bars",
    role: "subject",
    resolution: "exact_catalog_match",
  },
  {
    participantId: "p2",
    entityType: "system",
    rawName: "Shahed",
    resolvedId: "drone-shahed-136",
    role: "target",
    resolution: "alias_match",
  },
  {
    participantId: "p3",
    entityType: "system",
    rawName: "Patriot",
    resolvedId: "system-patriot",
    role: "subject",
    resolution: "exact_catalog_match",
  },
  {
    participantId: "p4",
    entityType: "location",
    rawName: "Kyiv",
    role: "location",
    resolution: "unresolved",
  },
];

// --- fixture 2: a launcher's property, under a programme --------------------------------------

const locustCoyoteParticipants: AssertionEntity[] = [
  {
    participantId: "p1",
    entityType: "system",
    rawName: "Coyote",
    role: "subject",
    resolution: "unresolved",
  },
  {
    participantId: "p2",
    entityType: "programme",
    rawName: "LOCUST",
    role: "programme_context",
    resolution: "unresolved",
  },
  {
    participantId: "p3",
    entityType: "component",
    rawName: "40-tube tube launcher",
    role: "launcher",
    resolution: "unresolved",
  },
];

// --- fixture 3: a load factor is not a mass ----------------------------------------------------

const loadFactorParticipants: AssertionEntity[] = [
  {
    participantId: "p1",
    entityType: "unknown",
    rawName: "The airframe",
    role: "subject",
    resolution: "unresolved",
  },
  {
    participantId: "p2",
    entityType: "component",
    rawName: "optical payload",
    role: "payload",
    resolution: "unresolved",
  },
];

// --- fixture 4: a production rate is not a stock ----------------------------------------------

const productionInventoryParticipants: AssertionEntity[] = [
  {
    participantId: "p1",
    entityType: "unknown",
    rawName: "The system",
    role: "subject",
    resolution: "unresolved",
  },
];

const specifiedFixtures: RelationshipFixture[] = [
  {
    id: "bars-patriot",
    title: "Two systems in one sentence keep their own engagements",
    sourceText:
      "Ukrainian Bars interceptors countered Russian Shahed strikes while Patriot batteries defended Kyiv.",
    participants: barsPatriotParticipants,
    expectedFrames: [
      {
        evidence: "Ukrainian Bars interceptors countered Russian Shahed strikes",
        sentenceIndex: 0,
        predicate: "countered",
        participants: barsPatriotParticipants,
        subjectEntityId: "p1",
        targetEntityId: "p2",
      },
      {
        evidence: "Patriot batteries defended Kyiv",
        sentenceIndex: 0,
        predicate: "defended",
        participants: barsPatriotParticipants,
        subjectEntityId: "p3",
        targetEntityId: "p4",
      },
    ],
    expectedClaims: [],
    mustNotProduce: [
      "Patriot linked as actor or system to the Shahed engagement",
      "Bars linked to Kyiv air-defence batteries",
    ],
    activeFrom: "phase4",
  },
  {
    id: "locust-coyote",
    title: "A launcher's tube count belongs to the launcher, not the munition",
    sourceText:
      "Under the LOCUST programme, Coyote UAVs were launched from a 40-tube tube launcher.",
    participants: locustCoyoteParticipants,
    expectedFrames: [
      {
        evidence: "Coyote UAVs were launched from a 40-tube tube launcher",
        sentenceIndex: 0,
        predicate: "launched_from",
        participants: locustCoyoteParticipants,
        subjectEntityId: "p1",
        contextEntityId: "p2",
        measurement: {
          ownerParticipantId: "p3",
          rawKey: "launcher.tube_count",
          rawValue: 40,
          rawUnit: "tubes",
        },
      },
    ],
    expectedClaims: [
      {
        semantic: "launcher.tube_count",
        domain: "technical_specification",
        value: 40,
        unit: "tubes",
        ownerParticipantId: "p3",
      },
    ],
    mustNotProduce: [
      "LOCUST as actor or as an unmanned aircraft system",
      "the tube count attributed to Coyote",
    ],
    activeFrom: "phase4",
  },
  {
    id: "load-factor-vs-mass",
    title: "A load factor in g is not a mass in g",
    sourceText: "The airframe withstands 4g during evasive maneuvers with a 500 g optical payload.",
    participants: loadFactorParticipants,
    expectedFrames: [],
    expectedClaims: [
      {
        semantic: "maneuver.load_factor_max",
        domain: "technical_specification",
        value: 4,
        unit: "g",
        dimension: "load_factor",
        ownerParticipantId: "p1",
      },
      {
        semantic: "payload.mass",
        domain: "technical_specification",
        value: 500,
        unit: "g",
        dimension: "mass",
        canonicalValue: 0.5,
        canonicalUnit: "kg",
        ownerParticipantId: "p2",
      },
    ],
    mustNotProduce: ["4g read as 4 grams or converted to 39.2 m/s2", "500 g read as a load factor"],
    activeFrom: "phase5",
  },
  {
    id: "production-vs-inventory",
    title: "A production rate is not added to a deployed stock",
    sourceText: "The system is produced at 50 units/month with 300 currently deployed in theater.",
    participants: productionInventoryParticipants,
    expectedFrames: [],
    expectedClaims: [
      {
        semantic: "production.rate_monthly",
        domain: "operational",
        value: 50,
        unit: "units/month",
        dimension: "count_rate",
        ownerParticipantId: "p1",
      },
      {
        semantic: "inventory.deployed_count",
        domain: "operational",
        value: 300,
        unit: "units",
        ownerParticipantId: "p1",
      },
    ],
    mustNotProduce: ["a merged 350", "production rate confused with delivered quantity"],
    activeFrom: "phase5",
  },
];

/** Placeholder slot: the failure class is named, the sentence is not invented. */
function awaiting(id: string, title: string, activeFrom: FixtureActivePhase): RelationshipFixture {
  return {
    id,
    title,
    sourceText: "",
    participants: [],
    expectedFrames: [],
    expectedClaims: [],
    mustNotProduce: [],
    activeFrom,
    status: "awaiting_source_text",
    note: "Placeholder slot. Source text not supplied; not a regression.",
  };
}

const placeholderFixtures: RelationshipFixture[] = [
  awaiting("rca-05", "lbs to kg conversion keeps the source unit", "phase5"),
  awaiting("rca-06", "interval versus point value (20-35 kW vs 50 kW)", "phase6"),
  awaiting("rca-07", "zero median is a value, not a missing one", "phase6"),
  awaiting("rca-08", "syndicated duplicate counts once", "phase6"),
  awaiting("rca-09", "up_to / at_least bound mixed with point values", "phase6"),
  awaiting("rca-10", "qualifier max versus cruise stay separate", "phase6"),
  awaiting("rca-11", "two systems in one sentence", "phase4"),
  awaiting("rca-12", "launcher versus munition count", "phase4"),
  awaiting("rca-13", "programme context used as actor", "phase4"),
  awaiting("rca-14", "ru/uk source with transliterated system name", "phase4"),
  awaiting("rca-15", "fabricated quote is not accepted as evidence", "phase4"),
];

/** All fifteen fixtures: four specified, eleven placeholder slots, in id order. */
export const RELATIONSHIP_FIXTURES: readonly RelationshipFixture[] = [
  ...specifiedFixtures,
  ...placeholderFixtures,
];
