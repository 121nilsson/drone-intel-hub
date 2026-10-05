import { createFileRoute } from "@tanstack/react-router";
import { IntakePage } from "@/features/intake/intake-page";

export const Route = createFileRoute("/intake")({
  validateSearch: (s: Record<string, unknown>): { draft?: string; source?: string } => ({
    ...(typeof s.draft === "string" ? { draft: s.draft } : {}),
    ...(typeof s.source === "string" ? { source: s.source } : {}),
  }),
  head: () => ({ meta: [
    { title: "Intake & Triage Queue — DRONE//INT" },
    { name: "description", content: "Paste raw dispatches for two-tier AI extraction and analyst triage." },
    { property: "og:title", content: "Intake & Triage Queue — DRONE//INT" },
    { property: "og:description", content: "Paste raw dispatches for two-tier AI extraction and analyst triage." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: IntakeRoute,
});

function IntakeRoute() {
  const { draft, source } = Route.useSearch();
  return <IntakePage draft={draft} draftSource={source} />;
}
