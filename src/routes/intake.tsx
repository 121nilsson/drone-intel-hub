import { createFileRoute } from "@tanstack/react-router";
import { IntakePage } from "@/features/intake/intake-page";
import { intakePageParams, parseIntakePage, withIntakePage } from "@/features/intake/intake-search";

export const Route = createFileRoute("/intake")({
  validateSearch: (
    s: Record<string, unknown>,
  ): { draft?: string; source?: string; page?: string } => ({
    ...(typeof s["draft"] === "string" ? { draft: s["draft"] } : {}),
    ...(typeof s["source"] === "string" ? { source: s["source"] } : {}),
    ...intakePageParams(s["page"]),
  }),
  head: () => ({
    meta: [
      { title: "Intake & Triage Queue — DRONE//INT" },
      {
        name: "description",
        content: "Paste raw dispatches for two-tier AI extraction and analyst triage.",
      },
      { property: "og:title", content: "Intake & Triage Queue — DRONE//INT" },
      {
        property: "og:description",
        content: "Paste raw dispatches for two-tier AI extraction and analyst triage.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: IntakeRoute,
});

function IntakeRoute() {
  const { draft, source, page } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <IntakePage
      draft={draft}
      draftSource={source}
      page={parseIntakePage(page)}
      onPageChange={(next) =>
        navigate({ search: (prev) => withIntakePage(prev, next), replace: true })
      }
    />
  );
}
