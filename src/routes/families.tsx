import { createFileRoute } from "@tanstack/react-router";
import { FamiliesPage } from "@/features/families/families-page";

const desc =
  "Which entries are families, which are their variants, and which names are filed in the wrong place - proposals for the analyst.";

export const Route = createFileRoute("/families")({
  head: () => ({
    meta: [
      { title: "Families — DRONE//INT" },
      { name: "description", content: desc },
      { property: "og:title", content: "Families — DRONE//INT" },
      { property: "og:description", content: desc },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => <FamiliesPage />,
});
