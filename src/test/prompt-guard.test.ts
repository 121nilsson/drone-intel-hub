import { describe, expect, it } from "vitest";
import prompt from "@/shared/contracts/extraction-prompt.json";
import {
  EXTRACTION_PROMPT_HASH,
  EXTRACTION_PROMPT_VERSION,
} from "@/shared/contracts/extraction.schema";
import { fnv1a } from "@/shared/contracts/proposals";

describe("extraction prompt identity", () => {
  it("the stored hash is the fnv1a of the system prompt", () => {
    expect(fnv1a(prompt.system)).toBe(prompt.hash);
  });

  // A prompt edit must bump both the version and the hash below. The pair is pinned here so an
  // edit that forgets either one fails this test, rather than silently mislabelling claims.
  it("pins the prompt version and hash", () => {
    expect({ version: EXTRACTION_PROMPT_VERSION, hash: EXTRACTION_PROMPT_HASH }).toEqual({
      version: "drone-osint-v8",
      hash: "yaauji",
    });
  });
});
