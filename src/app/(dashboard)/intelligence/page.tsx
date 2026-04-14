import Link from "next/link";
import { FileType, BarChart3, History } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

const sections = [
  {
    title: "Document Types",
    description: "Define document types for automatic classification and field validation",
    href: "/intelligence/document-types",
    icon: FileType,
  },
  {
    title: "Dashboard",
    description: "Validation metrics and processing analytics",
    href: "/intelligence/dashboard",
    icon: BarChart3,
  },
  {
    title: "Validation History",
    description: "Audit log of all validation results from document processing",
    href: "/intelligence/audit",
    icon: History,
  },
];

export default function IntelligencePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Intelligence</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Document classification, validation, and processing analytics.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-muted/30 p-4">
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Document Types</span> define
          what the AI looks for when classifying downloaded files.{" "}
          <span className="font-medium text-foreground">Dashboard</span> and{" "}
          <span className="font-medium text-foreground">Validation History</span> show
          processing results — visit them after running a scrape session.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sections.map((section) => {
          const Icon = section.icon;
          return (
            <Link key={section.title} href={section.href}>
              <Card className="transition-colors hover:border-primary/40 hover:shadow-md">
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <CardTitle className="text-base">{section.title}</CardTitle>
                      <CardDescription className="mt-0.5">{section.description}</CardDescription>
                    </div>
                  </div>
                </CardHeader>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
