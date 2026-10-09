import { createFileRoute } from "@tanstack/react-router";
import { DossierPage } from "@/features/dossier/dossier-page";

export const Route = createFileRoute("/systems/$id")({
  head: ({ params }) => ({
    meta: [
      { title: `${params.id} dossier — DRONE//INT` },
      {
        name: "description",
        content:
          "Technical intelligence dossier: consensus specs, RF spectrum, supply chain and evolution.",
      },
      { property: "og:title", content: `${params.id} dossier — DRONE//INT` },
      { property: "og:description", content: "Technical intelligence dossier for a drone system." },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => {
    const { id } = Route.useParams();
    return <DossierPage id={id} />;
  },
});
