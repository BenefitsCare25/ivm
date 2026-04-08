"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

interface ReviewTabsProps {
  resultsContent: React.ReactNode;
  historyContent: React.ReactNode;
}

const TABS = [
  { id: "results", label: "Results" },
  { id: "history", label: "History" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function ReviewTabs({ resultsContent, historyContent }: ReviewTabsProps) {
  const [activeTab, setActiveTab] = useState<TabId>("results");

  return (
    <div>
      <div className="flex gap-1 border-b border-border mb-6">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "px-4 py-2 text-sm font-medium transition-colors",
              activeTab === tab.id
                ? "border-b-2 border-foreground text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "results" && resultsContent}
      {activeTab === "history" && historyContent}
    </div>
  );
}
