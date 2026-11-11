import { describe, expect, it } from "vitest";
import type { Drone, SpecClaim } from "@/entities/drone/types";
import type { RawDispatch } from "@/entities/dispatch/types";
import type { DroneRepository } from "@/shared/contracts/repository";
import {
  backfillCatalogue,
  backfillDrones,
  dispatchHashResolver,
  dispatchTextResolver,
  sourcePostLinker,
} from "@/shared/infra/verification/backfill";

const AT = "2026-10-20T12:00:00.000Z";
const HASH = "0000000000000000";
const NEAR = "0000000000000007";

const claim = (source: string, sourceId: string, lineage?: SpecClaim["lineage"]): SpecClaim => ({
  id: `c-${sourceId}`,
  value: 2_000,
  source,
  sourceId,
  date: "2026-10-01T00:00:00.000Z",
  normalized: { raw: "2000 km", canonicalValue: 2_000, canonicalUnit: "km", confidence: 1 },
  ...(lineage ? { lineage } : {}),
});

const drone = (claims: SpecClaim[]): Drone => ({
  id: "x",
  name: "X",
  aliases: [],
  domain: "Air",
  origin: "RU",
  operators: [],
  propulsion: "Unknown",
  summary: "",
  specs: [
    {
      key: "range_max",
      label: "range_max",
      unit: "km",
      semantic: "range.max",
      canonicalUnit: "km",
      discoveredBy: "ai",
      claims,
    },
  ],
  rf: [],
  components: [],
  evolution: [],
  counterpartIds: [],
  createdAt: "",
  updatedAt: "",
});

const post = (id: string, contentHash: string | undefined, text = "range 2,000 km") =>
  ({ id, sourceName: "Outlet", url: "", text, contentHash }) as unknown as RawDispatch;

/** Two outlets, two posts of one text: the second post's hash is a few bits from the first. */
const repost = () =>
  drone([
    claim("Outlet A · https://a.example/1", "p1"),
    claim("Outlet B · https://b.example/1", "p2"),
  ]);
const posts = () => [post("p1", HASH), post("p2", NEAR)];

describe("backfilling content hashes onto claims", () => {
  it("stamps a claim with its post's hash and counts the repost in the same run", () => {
    const dispatches = posts();
    const result = backfillDrones(
      [repost()],
      dispatchTextResolver(dispatches),
      undefined,
      AT,
      undefined,
      dispatchHashResolver(dispatches),
    );
    const [first, second] = result.drones[0]!.specs[0]!.claims;
    expect(first!.lineage?.contentHash).toBe(HASH);
    expect(second!.lineage?.contentHash).toBe(NEAR);
    expect(first!.verification?.independentSources).toBe(1);
  });

  it("counts the same claims as two sources when no hash is stamped", () => {
    const dispatches = posts();
    const result = backfillDrones([repost()], dispatchTextResolver(dispatches), undefined, AT);
    expect(result.drones[0]!.specs[0]!.claims[0]!.verification?.independentSources).toBe(2);
  });

  it("keeps a hash the claim already carries", () => {
    const stored = drone([
      claim("Outlet A · https://a.example/1", "p1", { contentHash: "ffffffffffffffff" }),
      claim("Outlet B · https://b.example/1", "p2"),
    ]);
    const dispatches = posts();
    const result = backfillDrones(
      [stored],
      dispatchTextResolver(dispatches),
      undefined,
      AT,
      undefined,
      dispatchHashResolver(dispatches),
    );
    expect(result.drones[0]!.specs[0]!.claims[0]!.lineage).toEqual({
      contentHash: "ffffffffffffffff",
    });
  });

  it("uses the hash of an emptied post, such as an irrelevant one, and leaves its text alone", () => {
    const dispatches = [post("p1", HASH), post("p2", NEAR, "")];
    const result = backfillDrones(
      [repost()],
      dispatchTextResolver(dispatches),
      undefined,
      AT,
      undefined,
      dispatchHashResolver(dispatches),
    );
    expect(result.drones[0]!.specs[0]!.claims[1]!.lineage?.contentHash).toBe(NEAR);
    expect(result.drones[0]!.specs[0]!.claims[0]!.verification?.independentSources).toBe(1);
  });

  it("links a claim without a post id to the post with text, not to a same-URL duplicate stub", () => {
    const url = "https://a.example/1";
    const dispatches = [
      { id: "p1", sourceName: "Outlet", url, text: "range 2,000 km" },
      { id: "p2", sourceName: "Outlet", url, text: "", contentHash: HASH },
    ] as unknown as RawDispatch[];
    const linkTo = sourcePostLinker(dispatches);
    const unlinked = claim(`Outlet · ${url}`, "unused");
    delete unlinked.sourceId;
    expect(linkTo(unlinked)).toBe("p1");
  });

  it("writes the stamped hash and its count through the repository in backfillCatalogue", async () => {
    const written: Drone[] = [];
    const drones = {
      list: () => [repost()],
      upsert: (d: Drone) => {
        written.push(d);
      },
    } as unknown as DroneRepository;
    const dispatches = { list: () => posts() };
    await backfillCatalogue({ drones, dispatches });
    const [first] = written[0]!.specs[0]!.claims;
    expect(first!.lineage?.contentHash).toBe(HASH);
    expect(first!.verification?.independentSources).toBe(1);
  });
});
