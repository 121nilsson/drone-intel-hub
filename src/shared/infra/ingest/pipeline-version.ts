import { EXTRACTION_PROMPT_VERSION } from "@/shared/contracts/extraction.schema";

/**
 * The analysis pipeline a post was processed with. Includes the prompt version, so a prompt
 * change re-analyses old posts on its own; bump the suffix for a pipeline change that should too
 * (`/2`: AI-decided identity, the auto-promotion guards, and the outage handling).
 */
export const PIPELINE_VERSION = `${EXTRACTION_PROMPT_VERSION}/2`;
