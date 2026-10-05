import { createFileRoute } from "@tanstack/react-router";
import { CatalogPage } from "@/features/catalog/catalog-page";

export const Route = createFileRoute("/catalog")({
  head: () => ({ meta: [
    { title: "Systems Catalog — DRONE//INT" },
    { name: "description", content: "Search and filter air, land, sea and multi-domain drone systems." },
    { property: "og:title", content: "Systems Catalog — DRONE//INT" },
    { property: "og:description", content: "Search and filter air, land, sea and multi-domain drone systems." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: () => <CatalogPage />,
});
