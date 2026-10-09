import { createFileRoute } from "@tanstack/react-router";
import { SpecsPage } from "@/features/dynamic-specs/specs-page";

export const Route = createFileRoute("/specs")({
  head: () => ({
    meta: [
      { title: "Dynamic Spec Engine — DRONE//INT" },
      {
        name: "description",
        content: "Manage schema-less technical attributes discovered across the catalog.",
      },
      { property: "og:title", content: "Dynamic Spec Engine — DRONE//INT" },
      {
        property: "og:description",
        content: "Manage schema-less technical attributes discovered across the catalog.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => <SpecsPage />,
});
