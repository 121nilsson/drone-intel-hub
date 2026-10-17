import { createFileRoute } from "@tanstack/react-router";
import { EvaluationPage } from "@/features/evaluation/evaluation-page";

const desc = "Measure the heuristic engine against stored extractions and export regression fixtures.";

export const Route = createFileRoute("/evaluation")({
  head: () => ({
    meta: [
      { title: "Heuristic evaluation — DRONE//INT" },
      { name: "description", content: desc },
      { property: "og:title", content: "Heuristic evaluation — DRONE//INT" },
      { property: "og:description", content: desc },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => <EvaluationPage />,
});
