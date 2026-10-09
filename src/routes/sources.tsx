import { createFileRoute } from "@tanstack/react-router";
import { SourcesPage } from "@/features/sources/sources-page";

export const Route = createFileRoute("/sources")({
  head: () => ({
    meta: [
      { title: "Monitored Sources — DRONE//INT" },
      {
        name: "description",
        content:
          "Watchlist of Telegram channels, X accounts and defence sites monitored for drone intelligence.",
      },
      { property: "og:title", content: "Monitored Sources — DRONE//INT" },
      {
        property: "og:description",
        content:
          "Watchlist of Telegram channels, X accounts and defence sites monitored for drone intelligence.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => <SourcesPage />,
});
