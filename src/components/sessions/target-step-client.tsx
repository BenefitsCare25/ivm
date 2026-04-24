"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { TargetTypeSelector } from "./target-type-selector";
import { TargetUrlInput } from "./target-url-input";
import { TargetFileUpload } from "./target-file-upload";
import { TargetPreview } from "./target-preview";
import type { TargetAssetData, TargetType } from "@/types/target";

interface TargetStepClientProps {
  sessionId: string;
  hasExtraction: boolean;
  initialTarget: TargetAssetData | null;
}

type Step = "select" | "input" | "preview";

export function TargetStepClient({
  sessionId,
  hasExtraction,
  initialTarget,
}: TargetStepClientProps) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(initialTarget ? "preview" : "select");
  const [selectedType, setSelectedType] = useState<TargetType | null>(
    initialTarget?.targetType ?? null
  );
  const [target, setTarget] = useState<TargetAssetData | null>(initialTarget);

  const handleTypeSelect = useCallback((type: TargetType) => {
    setSelectedType(type);
    setStep("input");
  }, []);

  const handleComplete = useCallback(
    (newTarget: TargetAssetData) => {
      setTarget(newTarget);
      setStep("preview");
      router.refresh();
    },
    [router]
  );

  const handleReplace = useCallback(() => {
    setSelectedType(null);
    setTarget(null);
    setStep("select");
  }, []);

  const handleBack = useCallback(() => {
    setSelectedType(null);
    setStep("select");
  }, []);

  if (!hasExtraction) {
    return (
      <Card className="p-8 text-center">
        <p className="text-sm text-muted-foreground">
          Complete field extraction first before selecting a target.
        </p>
        <Button
          variant="outline"
          size="sm"
          className="mt-3"
          onClick={() => router.push(`/sessions/${sessionId}/extract`)}
        >
          Go to Extraction
        </Button>
      </Card>
    );
  }

  if (step === "select") {
    return <TargetTypeSelector onSelect={handleTypeSelect} />;
  }

  if (step === "input" && selectedType) {
    if (selectedType === "WEBPAGE") {
      return (
        <TargetUrlInput
          sessionId={sessionId}
          onComplete={handleComplete}
          onBack={handleBack}
        />
      );
    }
    return (
      <TargetFileUpload
        sessionId={sessionId}
        targetType={selectedType}
        onComplete={handleComplete}
        onBack={handleBack}
      />
    );
  }

  if (step === "preview" && target) {
    return (
      <div className="space-y-4">
        <TargetPreview target={target} onReplace={handleReplace} />
        <div className="flex justify-end">
          <Button onClick={() => router.push(`/sessions/${sessionId}/map`)}>
            Continue to Mapping
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  }

  return null;
}
