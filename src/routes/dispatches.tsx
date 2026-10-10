import { createFileRoute } from "@tanstack/react-router";
import { DispatchesPage } from "@/features/dispatches/dispatches-page";

export const Route = createFileRoute("/dispatches")({
  validateSearch: (s: Record<string, unknown>): { q?: string } =>
    typeof s.q === "string" && s.q ? { q: s.q } : {},
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
  const { q } = Route.useSearch();
  return <DispatchesPage key={q ?? ""} initialQuery={q ?? ""} />;
}
