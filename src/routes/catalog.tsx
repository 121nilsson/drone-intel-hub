import { createFileRoute } from "@tanstack/react-router";
import { CatalogPage } from "@/features/catalog/catalog-page";
import { parseCatalogSearchParams } from "@/features/catalog/catalog-state";

export const Route = createFileRoute("/catalog")({
  // Facets, query and sort are URL state so catalog views can be shared and survive a refresh.
  // The params stay shallow strings; the catalog feature owns all parsing of values.
  validateSearch: (s: Record<string, unknown>) => parseCatalogSearchParams(s),
  head: () => ({
    meta: [
      { title: "Systems Catalog — DRONE//INT" },
      {
        name: "description",
        content: "Search and filter air, land, sea and multi-domain drone systems.",
      },
      { property: "og:title", content: "Systems Catalog — DRONE//INT" },
      {
        property: "og:description",
        content: "Search and filter air, land, sea and multi-domain drone systems.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CatalogRoute,
});

function CatalogRoute() {
  const url = Route.useSearch();
  const navigate = Route.useNavigate();
  // replace: a filter click is not a page the analyst wants in their back button history.
  return <CatalogPage url={url} setUrl={(next) => navigate({ search: next, replace: true })} />;
}
