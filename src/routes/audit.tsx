import { createFileRoute } from "@tanstack/react-router";
import { AuditPage } from "@/features/autonomy/audit-page";

const desc =
  "How often a verified claim is right: a person reads a random sample, and a stopping rule decides what the answers prove.";

export const Route = createFileRoute("/audit")({
  head: () => ({
    meta: [
      { title: "Audit — DRONE//INT" },
      { name: "description", content: desc },
      { property: "og:title", content: "Audit — DRONE//INT" },
      { property: "og:description", content: desc },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => <AuditPage />,
});
