import { createFileRoute } from "@tanstack/react-router";
import { AutonomyPage } from "@/features/autonomy/autonomy-page";

const desc =
  "What the engine decides on its own: deterministic claim verification, its coverage, and the decisions it recorded.";

export const Route = createFileRoute("/autonomy")({
  head: () => ({
    meta: [
      { title: "Autonomy — DRONE//INT" },
      { name: "description", content: desc },
      { property: "og:title", content: "Autonomy — DRONE//INT" },
      { property: "og:description", content: desc },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => <AutonomyPage />,
});
