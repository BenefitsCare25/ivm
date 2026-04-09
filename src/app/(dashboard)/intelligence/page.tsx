import Link from "next/link";
import {
  FileType,
  FolderCheck,
  Database,
  ArrowRightLeft,
  GitBranch,
  ScanSearch,
  BarChart3,
  History,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

const sections = [
  {
    title: "Document Types",
    description: "Define and classify document types with aliases and required fields",
    href: "/intelligence/document-types",
    icon: FileType,
  },
  {
    title: "Document Sets",
    description: "Required document packages for validation",
    href: "/intelligence/document-sets",
    icon: FolderCheck,
  },
  {
    title: "Reference Data",
    description: "Lookup tables and code mapping datasets",
    href: "/intelligence/datasets",
    icon: Database,
  },
  {
    title: "Mapping Rules",
    description: "Auto-map extracted fields to standard codes",
    href: "/intelligence/mapping-rules",
    icon: ArrowRightLeft,
  },
  {
    title: "Business Rules",
    description: "If/then processing rules for auto-flagging and validation",
    href: "/intelligence/rules",
    icon: GitBranch,
  },
  {
    title: "Extraction Config",
    description: "Templates, normalization, and escalation settings",
    href: "/intelligence/extraction",
    icon: ScanSearch,
  },
  {
    title: "Dashboard",
    description: "Analytics, metrics, and bulk processing",
    href: "/intelligence/dashboard",
    icon: BarChart3,
  },
  {
    title: "Audit Log",
    description: "Configuration change history and versioning",
    href: "/intelligence/audit",
    icon: History,
  },
];

export default function IntelligencePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Intelligence Hub</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure rules, datasets, and validation logic that run automatically during document processing.
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
