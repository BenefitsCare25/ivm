"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { ArrowLeft, Upload, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/form-error";
import { cn } from "@/lib/utils";
import type { TargetAssetData, TargetType } from "@/types/target";

interface TargetFileUploadProps {
  sessionId: string;
  targetType: Extract<TargetType, "PDF" | "DOCX">;
  onComplete: (target: TargetAssetData) => void;
  onBack: () => void;
}

const ACCEPT_MAP = { PDF: ".pdf", DOCX: ".docx" } as const;

export function TargetFileUpload({
  sessionId,
  targetType,
  onComplete,
  onBack,
}: TargetFileUploadProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(0);
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);

  useEffect(() => {
    return () => {
      xhrRef.current?.abort();
    };
  }, []);

  const uploadFile = useCallback(
    (file: File) => {
      setLoading(true);
      setError("");
      setProgress(0);

      const formData = new FormData();
      formData.append("file", file);
      formData.append("targetType", targetType);

      const xhr = new XMLHttpRequest();

      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
      });

      xhr.addEventListener("load", () => {
        setLoading(false);
        if (xhr.status === 201) {
          const target: TargetAssetData = JSON.parse(xhr.responseText);
          onComplete(target);
        } else {
          try {
            const data = JSON.parse(xhr.responseText);
            setError(data.error || `Upload failed (${xhr.status})`);
          } catch {
            setError(`Upload failed (${xhr.status})`);
          }
        }
      });

      xhr.addEventListener("error", () => {
        setLoading(false);
        setError("Network error during upload");
      });

      xhrRef.current = xhr;
      xhr.open("POST", `/api/sessions/${sessionId}/target`);
      xhr.send(formData);
    },
    [sessionId, targetType, onComplete]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragActive(false);
      const file = e.dataTransfer.files[0];
      if (file) uploadFile(file);
    },
    [uploadFile]
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) uploadFile(file);
    },
    [uploadFile]
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back
        </Button>
        <span className="text-sm text-muted-foreground">
          Upload a {targetType === "PDF" ? "PDF with form fields" : "DOCX with {{placeholders}}"}
        </span>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 transition-colors",
          dragActive
            ? "border-foreground/40 bg-muted/50"
            : "border-border hover:border-foreground/20",
          loading && "pointer-events-none opacity-60"
        )}
      >
        {loading ? (
          <>
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <p className="mt-2 text-sm text-muted-foreground">
              Uploading & inspecting... {progress}%
            </p>
          </>
        ) : (
          <>
            <Upload className="h-8 w-8 text-muted-foreground" />
            <p className="mt-2 text-sm text-muted-foreground">
              Drop your {targetType} file here or click to browse
            </p>
            <p className="mt-1 text-xs text-muted-foreground/60">Max 10 MB</p>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT_MAP[targetType]}
          onChange={handleFileSelect}
          className="hidden"
        />
      </div>

      <FormError message={error} />
    </div>
  );
}
