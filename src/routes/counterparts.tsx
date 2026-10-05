import { createFileRoute } from "@tanstack/react-router";
import { CounterpartsPage } from "@/features/counterparts/counterparts-page";

export const Route = createFileRoute("/counterparts")({
  validateSearch: (s: Record<string, unknown>): { a?: string; b?: string } => ({
    ...(typeof s["a"] === "string" ? { a: s["a"] } : {}),
    ...(typeof s["b"] === "string" ? { b: s["b"] } : {}),
  }),
  head: () => ({ meta: [
    { title: "Counterpart Comparison — DRONE//INT" },
    { name: "description", content: "Compare doctrinal equivalents across opposing forces and shared RF vulnerabilities." },
    { property: "og:title", content: "Counterpart Comparison — DRONE//INT" },
    { property: "og:description", content: "Compare doctrinal equivalents across opposing forces and shared RF vulnerabilities." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: () => { const { a, b } = Route.useSearch(); return <CounterpartsPage a={a} b={b} />; },
});
