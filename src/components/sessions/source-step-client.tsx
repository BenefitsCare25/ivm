"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SourceUpload } from "./source-upload";
import { SourcePreview } from "./source-preview";
import type { SourceAssetData } from "@/types/extraction";

interface SourceStepClientProps {
  sessionId: string;
  initialAsset: SourceAssetData | null;
}

export function SourceStepClient({ sessionId, initialAsset }: SourceStepClientProps) {
  const router = useRouter();
  const [asset, setAsset] = useState<SourceAssetData | null>(initialAsset);
  const [isReplacing, setIsReplacing] = useState(false);

  const handleUploadComplete = useCallback(
    (uploaded: SourceAssetData) => {
      setAsset(uploaded);
      setIsReplacing(false);
      router.refresh();
    },
    [router]
  );

  const handleReplace = useCallback(() => {
    setIsReplacing(true);
  }, []);

  if (isReplacing || !asset) {
    return (
      <SourceUpload
        sessionId={sessionId}
        onUploadComplete={handleUploadComplete}
      />
    );
  }

  return (
    <div className="space-y-4">
      <SourcePreview asset={asset} onReplace={handleReplace} />
      <div className="flex justify-end">
        <Button onClick={() => router.push(`/sessions/${sessionId}/extract`)}>
          Continue to Extraction
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
