import { createFileRoute } from "@tanstack/react-router";
import { ProcurementPage } from "@/features/procurement/procurement-page";
import { parseProcurementSearchParams } from "@/features/procurement/procurement-state";

export const Route = createFileRoute("/procurement")({
  // Filters live in the URL so a buyer/currency view can be shared or refreshed.
  validateSearch: (s: Record<string, unknown>) => parseProcurementSearchParams(s),
  head: () => ({
    meta: [
      { title: "Procurement — DRONE//INT" },
      {
        name: "description",
        content: "Contracts, grants and production deals linked to drone systems.",
      },
      { property: "og:title", content: "Procurement — DRONE//INT" },
      {
        property: "og:description",
        content: "Contracts, grants and production deals linked to drone systems.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ProcurementRoute,
});

function ProcurementRoute() {
  const url = Route.useSearch();
  const navigate = Route.useNavigate();
  return <ProcurementPage url={url} setUrl={(next) => navigate({ search: next, replace: true })} />;
}
