import { createFileRoute } from "@tanstack/react-router";
import { SettingsPage } from "@/features/settings/settings-page";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — DRONE//INT" },
      {
        name: "description",
        content: "Configure an NVIDIA NIM or OpenAI-compatible inference provider.",
      },
      { property: "og:title", content: "Settings — DRONE//INT" },
      {
        property: "og:description",
        content: "Configure an NVIDIA NIM or OpenAI-compatible inference provider.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SettingsPage,
});
