"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/form-error";
import { cn } from "@/lib/utils";
import { getMimeIcon } from "@/lib/mime-icons";
import {
  ACCEPT_STRING,
  MAX_FILE_SIZE,
  formatFileSize,
  validateUploadFile,
} from "@/lib/validations/upload";
import type { SourceAssetData } from "@/types/extraction";

interface SourceUploadProps {
  sessionId: string;
  onUploadComplete: (asset: SourceAssetData) => void;
}

export function SourceUpload({ sessionId, onUploadComplete }: SourceUploadProps) {
  const [file, setFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);

  useEffect(() => {
    return () => {
      xhrRef.current?.abort();
    };
  }, []);

  const handleFile = useCallback((selected: File) => {
    setError("");
    const result = validateUploadFile({ size: selected.size, type: selected.type, name: selected.name });
    if (!result.valid) {
      setError(result.error!);
      return;
    }
    setFile(selected);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);
      const dropped = e.dataTransfer.files[0];
      if (dropped) handleFile(dropped);
    },
    [handleFile]
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const selected = e.target.files?.[0];
      if (selected) handleFile(selected);
    },
    [handleFile]
  );

  const handleUpload = useCallback(async () => {
    if (!file) return;
    setUploading(true);
    setProgress(0);
    setError("");

    const formData = new FormData();
    formData.append("file", file);

    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;

    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) {
        setProgress(Math.round((e.loaded / e.total) * 100));
      }
    });

    xhr.addEventListener("load", () => {
      xhrRef.current = null;
      setUploading(false);
      if (xhr.status === 201) {
        const asset = JSON.parse(xhr.responseText);
        onUploadComplete(asset);
      } else {
        try {
          const err = JSON.parse(xhr.responseText);
          setError(err.error || "Upload failed");
        } catch {
          setError("Upload failed");
        }
      }
    });

    xhr.addEventListener("error", () => {
      xhrRef.current = null;
      setUploading(false);
      setError("Network error. Please try again.");
    });

    xhr.open("POST", `/api/sessions/${sessionId}/upload`);
    xhr.send(formData);
  }, [file, sessionId, onUploadComplete]);

  const removeFile = useCallback(() => {
    xhrRef.current?.abort();
    xhrRef.current = null;
    setFile(null);
    setUploading(false);
    setProgress(0);
    setError("");
    if (inputRef.current) inputRef.current.value = "";
  }, []);

  const FileIcon = file ? getMimeIcon(file.type) : Upload;

  return (
    <div className="space-y-4">
      {!file ? (
        <div
          role="button"
          tabIndex={0}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
          }}
          className={cn(
            "flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-10 transition-colors cursor-pointer",
            dragActive
              ? "border-primary bg-primary/5"
              : "border-border bg-muted/30 hover:border-primary/50 hover:bg-muted/50"
          )}
        >
          <div className="rounded-full bg-muted p-4">
            <Upload className="h-6 w-6 text-muted-foreground" />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-foreground">
              Drag and drop your document here
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              or click to browse
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            PDF, PNG, JPG, WebP, DOCX &middot; Max {formatFileSize(MAX_FILE_SIZE)}
          </p>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT_STRING}
            onChange={handleInputChange}
            className="hidden"
          />
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-muted p-2">
              <FileIcon className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{file.name}</p>
              <p className="text-xs text-muted-foreground">
                {formatFileSize(file.size)} &middot; {file.type.split("/").pop()?.toUpperCase()}
              </p>
            </div>
            {!uploading && (
              <button
                onClick={removeFile}
                className="rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {uploading && (
            <div className="mt-3">
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="mt-1 text-xs text-muted-foreground text-right">{progress}%</p>
            </div>
          )}

          {!uploading && (
            <div className="mt-3 flex gap-2">
              <Button size="sm" onClick={handleUpload}>
                Upload
              </Button>
              <Button size="sm" variant="outline" onClick={removeFile}>
                Remove
              </Button>
            </div>
          )}
        </div>
      )}

      <FormError message={error} />
    </div>
  );
}
