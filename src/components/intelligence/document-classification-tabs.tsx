"use client";

import { useState } from "react";
import { FileType, FolderCheck } from "lucide-react";
import { DocumentTypeList } from "./document-type-list";
import { DocumentSetList } from "./document-set-list";
import { EmptyState } from "@/components/ui/empty-state";
import type { DocumentTypeData, DocumentSetData } from "@/types/intelligence";

interface DocumentClassificationTabsProps {
  documentTypes: DocumentTypeData[];
  documentSets: DocumentSetData[];
  availableDocTypes: { id: string; name: string }[];
}

const tabs = [
  { key: "types", label: "Document Types", icon: FileType },
  { key: "sets", label: "Document Sets", icon: FolderCheck },
] as const;

type TabKey = (typeof tabs)[number]["key"];

export function DocumentClassificationTabs({
  documentTypes,
  documentSets,
  availableDocTypes,
}: DocumentClassificationTabsProps) {
  const [activeTab, setActiveTab] = useState<TabKey>("types");

  return (
    <div className="space-y-4">
      <div className="flex gap-1 rounded-lg border border-border bg-muted/30 p-1">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === "types" && (
        <>
          {documentTypes.length === 0 && (
            <EmptyState
              icon={<FileType className="h-10 w-10" />}
              title="No document types yet"
              description="Create your first document type to start classifying documents automatically."
            />
          )}
          <DocumentTypeList documentTypes={documentTypes} />
        </>
      )}

      {activeTab === "sets" && (
        <>
          {documentSets.length === 0 && (
            <EmptyState
              icon={<FolderCheck className="h-10 w-10" />}
              title="No document sets yet"
              description="Create your first document set to define which documents are expected together."
            />
          )}
          <DocumentSetList
            documentSets={documentSets}
            availableDocTypes={availableDocTypes}
          />
        </>
      )}
    </div>
  );
}
