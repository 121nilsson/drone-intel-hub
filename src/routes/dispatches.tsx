import { createFileRoute } from "@tanstack/react-router";
import { DispatchesPage } from "@/features/dispatches/dispatches-page";
import { parseFeedSearchParams } from "@/features/dispatches/filters";

export const Route = createFileRoute("/dispatches")({
  // The feed's text query, status tab and source pick are shareable state; params stay shallow.
  validateSearch: (s: Record<string, unknown>) => parseFeedSearchParams(s),
  head: () => ({
    meta: [
      { title: "Intel Feed — DRONE//INT" },
      {
        name: "description",
        content:
          "Saved posts from monitored channels and feeds, filterable by status, source and text.",
      },
      { property: "og:title", content: "Intel Feed — DRONE//INT" },
      {
        property: "og:description",
        content:
          "Saved posts from monitored channels and feeds, filterable by status, source and text.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DispatchesRoute,
});

function DispatchesRoute() {
  const params = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <DispatchesPage url={params} setUrl={(next) => navigate({ search: next, replace: true })} />
  );
}
