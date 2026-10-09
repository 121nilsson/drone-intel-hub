import { createFileRoute } from "@tanstack/react-router";
import { TaxonomyPage } from "@/features/taxonomy/taxonomy-page";

export const Route = createFileRoute("/taxonomy")({
  head: () => ({
    meta: [
      { title: "Taxonomy — DRONE//INT" },
      {
        name: "description",
        content:
          "Map or promote propulsion and installation terms the normalizer could not classify.",
      },
      { property: "og:title", content: "Taxonomy — DRONE//INT" },
      {
        property: "og:description",
        content:
          "Map or promote propulsion and installation terms the normalizer could not classify.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => <TaxonomyPage />,
});
