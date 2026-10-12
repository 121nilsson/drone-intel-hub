import { createFileRoute } from "@tanstack/react-router";
import { SpectrumPage } from "@/features/spectrum/spectrum-page";

const title = "Spectrum Cat & Mouse — DRONE//INT";
const description =
  "Drone links vs jammer blankets and C-UAS radar bands: evasion gaps, fiber bypasses and detection coverage.";

export const Route = createFileRoute("/spectrum")({
  head: () => ({
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SpectrumPage,
});
