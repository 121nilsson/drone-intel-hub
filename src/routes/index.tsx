import { createFileRoute } from "@tanstack/react-router";
import { BriefingPage } from "@/features/briefing/briefing-page";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [
    { title: "7-Day Tactical Briefing — DRONE//INT" },
    { name: "description", content: "Weekly AI summary of drone technology shifts, new systems and spec drift." },
    { property: "og:title", content: "7-Day Tactical Briefing — DRONE//INT" },
    { property: "og:description", content: "Weekly AI summary of drone technology shifts, new systems and spec drift." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: () => <BriefingPage />,
});
