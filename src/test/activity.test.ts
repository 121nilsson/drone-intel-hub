import { describe, expect, it } from "vitest";
import {
  activityMetric,
  activityPeriod,
  toActivity,
  withActivity,
} from "@/entities/drone/activity";
import { mergeSpecs } from "@/entities/drone/spec-engine";
import { repairDrone } from "@/entities/drone/repair";
import type { Drone } from "@/entities/drone/types";

const READ = "2026-10-20T00:00:00.000Z";

const drone = (over: Partial<Drone> = {}): Drone => ({
  id: "geran",
  name: "Geran",
  aliases: [],
  domain: "Air",
  origin: "RU",
  operators: [],
  propulsion: "Unknown",
  summary: "",
  specs: [],
  rf: [],
  components: [],
  evolution: [],
  counterpartIds: [],
  createdAt: READ,
  updatedAt: READ,
  ...over,
});

describe("what counts as activity", () => {
  it("takes counts of events, by key or label", () => {
    expect(activityMetric({ key: "launch_volume_june", label: "Launch Volume (June)" })).toBe(
      "launched",
    );
    expect(activityMetric({ key: "kill_count", label: "Kill Count" })).toBe("kills");
    expect(activityMetric({ key: "quantity_received", label: "Received Quantity" })).toBe(
      "delivered",
    );
    expect(activityMetric({ key: "annual_production_target", label: "x" })).toBe("produced");
    expect(activityMetric({ key: "missiles_received_90d", label: "Missiles received" })).toBe(
      "delivered",
    );
    expect(activityMetric({ key: "missiles_fired", label: "Missiles fired" })).toBe("launched");
    expect(activityMetric({ key: "number_expended", label: "x" })).toBe("launched");
    expect(activityMetric({ key: "precision_engagements", label: "Precision engagements" })).toBe(
      "launched",
    );
  });

  it("leaves attributes that only mention an event as specs", () => {
    for (const key of [
      "weight_launch",
      "launch_weight",
      "launch_time_seconds",
      "first_launch_date",
      "production_timeline",
      "kill_probability",
      "production_cycle",
      "ammunition_type",
      "air_launched",
      "hand_launched",
      "launched_from",
      "kill_switch",
      "production_country",
      "serial_production",
      "signal_received",
      "power_supplied",
      "test_fired_range",
      "fire_rate",
      "simultaneous_engagements",
      "engagement_range",
      "range",
    ])
      expect(activityMetric({ key, label: key }), key).toBeUndefined();
  });
});

describe("the period a figure covers", () => {
  it("reads a month without a year as the latest one up to the report", () => {
    expect(activityPeriod("In June, Russia launched roughly 450", READ).period).toEqual({
      from: "2026-06-01",
      to: "2026-06-30",
      label: "June 2026",
    });
    expect(activityPeriod("In August it launched", "2027-02-10T00:00:00Z").period?.label).toBe(
      "August 2026",
    );
  });

  it("does not take the verb 'may' or the drone Лютий for a month", () => {
    expect(activityPeriod("drones may launch at night", READ).period).toBeUndefined();
    expect(activityPeriod("Лютий launched", READ).period).toBeUndefined();
    expect(activityPeriod("у лютому запустили", READ).period?.label).toBe("February 2026");
  });

  it("keeps a rate as a rate", () => {
    expect(activityPeriod("350 interceptor missiles per month", READ).per).toBe("month");
    expect(activityPeriod("annual production of 620", READ).per).toBe("year");
  });
});

describe("reading a period without false months or years", () => {
  it("does not take ordinary words for months", () => {
    expect(activityPeriod("запущено майже 3000 шахедів", READ).period).toBeUndefined();
    expect(activityPeriod("Червоний Хрест повідомив", READ).period).toBeUndefined();
    expect(activityPeriod("жовтий корпус", READ).period).toBeUndefined();
    expect(activityPeriod("у червні запустили 450", READ).period?.label).toBe("June 2026");
    expect(activityPeriod("в июне запустили 450", READ).period?.label).toBe("June 2026");
  });

  it("does not take a count for a year", () => {
    expect(
      activityPeriod("Russia launched 2048 Shaheds last month", READ, "2048").period,
    ).toBeUndefined();
    expect(activityPeriod("launched 2000 drones in 2025", READ, "2000").period?.label).toBe("2025");
  });

  it("takes the month nearest the figure", () => {
    const text = "After a lull in January, 2,800 were launched in August";
    expect(activityPeriod(text, READ, "2,800").period?.label).toBe("August 2026");
  });

  it("places a month without a year by when the post was published", () => {
    expect(activityPeriod("2,800 launched in December", "2025-11-03T00:00:00Z").period?.label).toBe(
      "December 2024",
    );
  });

  it("does not take 'a month ago' for a rate", () => {
    expect(activityPeriod("launched a month ago", READ).per).toBeUndefined();
    expect(activityPeriod("700 на добу", READ).per).toBe("day");
  });
});

describe("one record from one figure", () => {
  // Live: "In June, Russia launched roughly 450 jet-powered Gerans. In August, it launched more
  // than 2,800" - filed as specs "Launch Volume (June)" = 450 and "Launch Volume (August)" = 2,800.
  it("keeps the report's bound and approximation", () => {
    const ctx = { source: "s", date: READ };
    const june = toActivity(
      {
        key: "launch_volume_june",
        label: "Launch Volume (June)",
        value: 450,
        evidence: "In June, Russia launched roughly 450 jet-powered Gerans",
      },
      ctx,
    )!;
    expect(june).toMatchObject({
      metric: "launched",
      quantity: { value: 450, approximate: true },
      unit: "gerans",
      period: { label: "June 2026" },
    });
    const august = toActivity(
      {
        key: "launch_volume_august",
        label: "Launch Volume (August)",
        value: "2,800",
        evidence: "In August, it launched more than 2,800",
      },
      ctx,
    )!;
    expect(august.quantity).toEqual({ min: 2800 });
    expect(august.period?.label).toBe("August 2026");
  });

  it("reads magnitudes and ranges as every measurement is read", () => {
    const ctx = { source: "s", date: READ };
    const q = (raw: string) =>
      toActivity({ key: "kill_count", label: "Kills", value: raw, raw }, ctx)!.quantity;
    expect(q("2.5 thousand")).toEqual({ value: 2500 });
    expect(q("300-400")).toEqual({ min: 300, max: 400 });
    expect(q("2,800.")).toEqual({ value: 2800 });
    expect(q("2,800 drones")).toEqual({ value: 2800 });
  });

  it("files one figure once, whichever reader worded it, keeping the AI's", () => {
    const ctx = { source: "s", sourceId: "p1", date: READ };
    const heuristic = toActivity(
      {
        key: "launch_volume",
        label: "Launch volume",
        value: "2,800",
        evidence: "launched more than 2,800",
        provenance: "heuristic",
      },
      ctx,
    )!;
    const ai = toActivity(
      {
        key: "launched_august",
        label: "Launched in August",
        value: "more than 2,800",
        raw: "more than 2,800",
        provenance: "both",
      },
      { ...ctx },
    );
    // "launched_august" names no count, so only a key that does is activity.
    expect(ai).toBeUndefined();
    const ai2 = toActivity(
      {
        key: "launch_count",
        label: "Launch count",
        value: "more than 2,800",
        raw: "more than 2,800",
        provenance: "both",
      },
      ctx,
    )!;
    const merged = withActivity([heuristic], [ai2]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.provenance).toBe("both");
  });

  it("takes the counted noun after this record's own figure only", () => {
    const r = toActivity(
      {
        key: "launch_count",
        label: "Launches",
        value: "24",
        evidence: "Russia launched 2,800 drones and 24 missiles",
      },
      { source: "s", date: READ },
    )!;
    expect(r.unit).toBe("missiles");
  });

  it("never takes a property for a count by its label, nor a bare 'Quantity' label", () => {
    expect(activityMetric({ key: "missiles_per_launcher", label: "Quantity" })).toBeUndefined();
    expect(activityMetric({ key: "launch_weight", label: "Launch volume" })).toBeUndefined();
    // A bare quantity is as often a property (missiles per launcher) as a count: a spec.
    expect(activityMetric({ key: "quantity", label: "Quantity" })).toBeUndefined();
  });

  it("places nothing against a date that does not parse", () => {
    expect(activityPeriod("launched in August", "not a date").period).toBeUndefined();
  });

  it("files a repaired figure and the same figure re-read as one", () => {
    const old = toActivity(
      { key: "kill_count", label: "Kills", value: 600 },
      { source: "X · u", date: READ },
    )!;
    const reread = toActivity(
      { key: "kill_count", label: "Kills", value: 600 },
      { source: "X · u", sourceId: "p1", date: READ },
    )!;
    expect(withActivity([old], [reread])).toHaveLength(1);
  });

  it("is filed once however often the report is read", () => {
    const r = toActivity(
      { key: "kill_count", label: "Kills", value: 600 },
      { source: "s", date: READ },
    )!;
    expect(withActivity([r], [{ ...r, id: "other" }])).toHaveLength(1);
  });
});

describe("routing", () => {
  it("takes activity out of the specs wherever specs are merged", () => {
    const merged = mergeSpecs(
      drone(),
      [
        { key: "range", label: "Range", value: 2000, unit: "km" },
        { key: "launch_volume_june", label: "Launch Volume (June)", value: 450 },
      ],
      "Outlet · https://a/1",
      { sourceId: "p1" },
    );
    expect(merged.specs.map((s) => s.key)).toEqual(["range"]);
    expect(merged.activity).toHaveLength(1);
    expect(merged.activity![0]).toMatchObject({ metric: "launched", sourceId: "p1" });
  });

  it("moves stored activity out of the specs, but never an analyst's", () => {
    const stored = drone({
      specs: [
        {
          key: "launch_volume_august",
          label: "Launch Volume (August)",
          discoveredBy: "ai",
          claims: [
            { value: "2,800", source: "s", date: READ, evidence: "launched more than 2,800" },
          ],
        },
        {
          key: "kill_count",
          label: "Kill Count",
          discoveredBy: "analyst",
          claims: [{ value: 600, source: "Analyst", date: READ }],
        },
      ],
    });
    const r = repairDrone(stored);
    expect(r.changes.map((c) => c.kind)).toEqual(["activity"]);
    expect(r.drone.specs.map((s) => s.key)).toEqual(["kill_count"]);
    expect(r.drone.activity?.[0]?.quantity).toEqual({ min: 2800 });
    // A second repair finds nothing left to do.
    expect(repairDrone(r.drone).changes).toEqual([]);
  });
});
