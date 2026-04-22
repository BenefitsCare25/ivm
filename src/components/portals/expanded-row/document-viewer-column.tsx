"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { FileText, Download, ExternalLink, Loader2 } from "lucide-react";

interface ItemFile {
  id: string;
  fileName: string;
  mimeType: string;
}

interface DocumentViewerColumnProps {
  files: ItemFile[];
  portalId: string;
  sessionId: string;
  itemId: string;
}

function fileUrl(portalId: string, sessionId: string, itemId: string, fileId: string) {
  return `/api/portals/${portalId}/scrape/${sessionId}/items/${itemId}/files/${fileId}`;
}

function isImage(mimeType: string, fileName: string): boolean {
  if (mimeType.startsWith("image/")) return true;
  const ext = fileName.toLowerCase().split(".").pop();
  return ext === "jpg" || ext === "jpeg" || ext === "png" || ext === "gif" || ext === "webp" || ext === "bmp";
}

function isPdf(mimeType: string, fileName: string): boolean {
  if (mimeType === "application/pdf" || mimeType.startsWith("application/pdf")) return true;
  return fileName.toLowerCase().endsWith(".pdf");
}

function useBlobUrl(apiUrl: string) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let revoke: string | null = null;
    setLoading(true);
    setError(false);

    fetch(apiUrl, { credentials: "same-origin" })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.blob();
      })
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        revoke = url;
        setBlobUrl(url);
        setLoading(false);
      })
      .catch(() => {
        setError(true);
        setLoading(false);
      });

    return () => {
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [apiUrl]);

  return { blobUrl, loading, error };
}

function ImageViewer({ url, fileName }: { url: string; fileName: string }) {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: offset.x, origY: offset.y };
  }, [offset]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setOffset({ x: dragRef.current.origX + dx, y: dragRef.current.origY + dy });
  }, []);

  const handleMouseUp = useCallback(() => {
    dragRef.current = null;
    setIsDragging(false);
  }, []);

  const { blobUrl, loading, error } = useBlobUrl(url);

  if (loading) return <ViewerLoading />;
  if (error || !blobUrl) return <ViewerError fileName={fileName} url={url} />;

  return (
    <div
      className="relative h-[500px] w-full overflow-hidden rounded-md border border-border bg-muted/30"
      style={{ cursor: isDragging ? "grabbing" : "grab" }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={blobUrl}
        alt={fileName}
        className="absolute top-0 left-0 w-full select-none"
        style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
        draggable={false}
      />
    </div>
  );
}

function PdfViewer({ url, fileName }: { url: string; fileName: string }) {
  const { blobUrl, loading, error } = useBlobUrl(url);

  if (loading) return <ViewerLoading />;
  if (error || !blobUrl) return <ViewerError fileName={fileName} url={url} />;

  return (
    <iframe
      src={`${blobUrl}#view=FitH&toolbar=0`}
      className="h-[500px] w-full rounded-md border border-border"
      title={fileName}
    />
  );
}

function ViewerLoading() {
  return (
    <div className="flex items-center justify-center h-[500px] rounded-md border border-border bg-muted/30">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}

function ViewerError({ fileName, url }: { fileName: string; url: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-[500px] gap-3 rounded-md border border-border bg-muted/30">
      <FileText className="h-10 w-10 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">{fileName}</p>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs text-foreground hover:bg-muted/60 transition-colors"
      >
        <Download className="h-3.5 w-3.5" />
        Download
      </a>
    </div>
  );
}

function InlineFileViewer({ url, mimeType, fileName }: { url: string; mimeType: string; fileName: string }) {
  if (isImage(mimeType, fileName)) {
    return <ImageViewer url={url} fileName={fileName} />;
  }
  if (isPdf(mimeType, fileName)) {
    return <PdfViewer url={url} fileName={fileName} />;
  }
  return <ViewerError fileName={fileName} url={url} />;
}

export function DocumentViewerColumn({ files, portalId, sessionId, itemId }: DocumentViewerColumnProps) {
  const [selectedFileId, setSelectedFileId] = useState<string | null>(
    files.length > 0 ? files[0].id : null
  );

  const selectedFile = files.find((f) => f.id === selectedFileId);

  if (files.length === 0) {
    return (
      <div className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Documents
        </p>
        <div className="flex items-center justify-center h-[500px] rounded-md border border-border bg-muted/30">
          <p className="text-xs text-muted-foreground">No documents available.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Documents ({files.length})
      </p>

      {/* File selector chips */}
      <div className="flex flex-wrap gap-1.5">
        {files.map((f) => {
          const isSelected = f.id === selectedFileId;
          return (
            <button
              key={f.id}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setSelectedFileId(f.id);
              }}
              className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors ${
                isSelected
                  ? "border-primary bg-primary/10 text-foreground font-medium"
                  : "border-border bg-card text-muted-foreground hover:bg-muted/60"
              }`}
            >
              <FileText className="h-3 w-3 shrink-0" />
              <span className="max-w-[140px] truncate">{f.fileName}</span>
            </button>
          );
        })}
      </div>

      {/* Viewer */}
      {selectedFile && (
        <>
          <InlineFileViewer
            key={selectedFile.id}
            url={fileUrl(portalId, sessionId, itemId, selectedFile.id)}
            mimeType={selectedFile.mimeType}
            fileName={selectedFile.fileName}
          />
          <a
            href={fileUrl(portalId, sessionId, itemId, selectedFile.id)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ExternalLink className="h-3 w-3" />
            Open in new tab
          </a>
        </>
      )}
    </div>
  );
}
