import type { Domain } from "@/entities/drone/types";

export type SourcePlatform = "X" | "Telegram" | "RSS" | "Web";
export const PLATFORMS: SourcePlatform[] = ["X", "Telegram", "RSS", "Web"];

export interface MonitoredSource {
  id: string;
  name: string;
  platform: SourcePlatform;
  handle: string; // URL or @handle
  domain: Domain;
  notes: string;
  lastFetched?: string;
}
