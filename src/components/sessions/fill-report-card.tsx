import { Card, CardContent } from "@/components/ui/card";
import type { FillReport } from "@/types/fill";

interface FillReportCardProps {
  report: FillReport;
}

export function FillReportCard({ report }: FillReportCardProps) {
  const stats = [
    { label: "Total", value: report.total, className: "text-foreground" },
    { label: "Verified", value: report.verified, className: "text-emerald-500" },
    { label: "Applied", value: report.applied, className: "text-sky-500" },
    { label: "Failed", value: report.failed, className: "text-red-500" },
    { label: "Skipped", value: report.skipped, className: "text-muted-foreground" },
  ];

  return (
    <Card>
      <CardContent className="py-4">
        <div className="grid grid-cols-5 gap-4 text-center">
          {stats.map((stat) => (
            <div key={stat.label}>
              <p className={`text-2xl font-semibold ${stat.className}`}>
                {stat.value}
              </p>
              <p className="text-xs text-muted-foreground">{stat.label}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
