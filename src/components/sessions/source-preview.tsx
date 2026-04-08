"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatFileSize } from "@/lib/validations/upload";
import { getMimeIcon, isImageType } from "@/lib/mime-icons";
import type { SourceAssetData } from "@/types/extraction";

interface SourcePreviewProps {
  asset: SourceAssetData;
  onReplace: () => void;
}

export function SourcePreview({ asset, onReplace }: SourcePreviewProps) {
  const Icon = getMimeIcon(asset.mimeType);
  const fileUrl = `/api/files/${encodeURIComponent(asset.storagePath)}`;

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        {isImageType(asset.mimeType) ? (
          <div className="rounded-lg overflow-hidden border border-border bg-muted/30">
            <img
              src={fileUrl}
              alt={asset.originalName}
              className="max-h-80 w-full object-contain"
            />
          </div>
        ) : (
          <div className="flex items-center justify-center rounded-lg border border-border bg-muted/30 p-8">
            <div className="flex flex-col items-center gap-2">
              <Icon className="h-12 w-12 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                {asset.mimeType.split("/").pop()?.toUpperCase()} Document
              </p>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground truncate">{asset.originalName}</p>
            <p className="text-xs text-muted-foreground">
              {formatFileSize(asset.sizeBytes)} &middot;{" "}
              {asset.mimeType.split("/").pop()?.toUpperCase()}
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={onReplace}>
            Replace
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
