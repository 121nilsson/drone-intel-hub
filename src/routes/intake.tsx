import { createFileRoute } from "@tanstack/react-router";
import { IntakePage } from "@/features/intake/intake-page";

export const Route = createFileRoute("/intake")({
  head: () => ({ meta: [
    { title: "Intake & Triage Queue — DRONE//INT" },
    { name: "description", content: "Paste raw dispatches for two-tier AI extraction and analyst triage." },
    { property: "og:title", content: "Intake & Triage Queue — DRONE//INT" },
    { property: "og:description", content: "Paste raw dispatches for two-tier AI extraction and analyst triage." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: () => <IntakePage />,
});
