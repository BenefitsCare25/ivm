import { SwaggerUI } from "@/components/docs/swagger-ui";

export const metadata = {
  title: "IVM API Docs",
  description: "IVM REST API reference",
};

export default function DocsPage() {
  return (
    <div className="min-h-screen bg-white">
      <SwaggerUI url="/openapi.yaml" />
    </div>
  );
}
