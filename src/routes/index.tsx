import { createFileRoute } from "@tanstack/react-router";
import { LabApp } from "@/components/lab/LabApp";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "secp256k1 Visual Pattern Explorer" },
      { name: "description", content: "Interactive lab for exploring geometric and statistical patterns of synthetic secp256k1 public points." },
      { property: "og:title", content: "secp256k1 Visual Pattern Explorer" },
      { property: "og:description", content: "Generate synthetic secp256k1 points, apply projections, and analyse spatial statistics." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: LabApp,
});
