"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { FileText, Download, ZoomIn, X, Loader2 } from "lucide-react";
import type { ItemFile } from "@/types/portal";

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
  if (mimeType === "application/pdf") return true;
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

function ImageLightbox({ blobUrl, fileName, onClose }: { blobUrl: string; fileName: string; onClose: () => void }) {
  const offsetRef = useRef({ x: 0, y: 0 });
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCloseRef.current();
    }
    const container = containerRef.current;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      setScale((prev) => {
        const next = Math.min(Math.max(prev * (e.deltaY < 0 ? 1.15 : 0.87), 0.25), 10);
        return next === prev ? prev : next;
      });
    }
    document.addEventListener("keydown", onKey);
    container?.addEventListener("wheel", onWheel, { passive: false });
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      container?.removeEventListener("wheel", onWheel);
      document.body.style.overflow = "";
    };
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: offsetRef.current.x, origY: offsetRef.current.y };
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragRef.current) return;
    const next = {
      x: dragRef.current.origX + (e.clientX - dragRef.current.startX),
      y: dragRef.current.origY + (e.clientY - dragRef.current.startY),
    };
    offsetRef.current = next;
    setOffset(next);
  }, []);

  const handleMouseUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setScale(1);
    offsetRef.current = { x: 0, y: 0 };
    setOffset({ x: 0, y: 0 });
  }, []);

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute top-4 right-4 z-10 rounded-full bg-card/80 p-2 text-foreground hover:bg-card transition-colors"
      >
        <X className="h-5 w-5" />
      </button>
      <p className="absolute top-4 left-4 text-sm text-white/70 select-none">{fileName}</p>
      <p className="absolute bottom-4 left-1/2 -translate-x-1/2 text-xs text-white/40 select-none">
        Scroll to zoom &middot; Drag to pan &middot; Double-click to reset
      </p>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={blobUrl}
        alt={fileName}
        className="max-h-[90vh] max-w-[90vw] select-none"
        style={{
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
          cursor: "grab",
        }}
        draggable={false}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={handleDoubleClick}
        onMouseDown={(e) => { e.stopPropagation(); handleMouseDown(e); }}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      />
    </div>
  );
}

function ImageViewer({ url, fileName }: { url: string; fileName: string }) {
  const [showLightbox, setShowLightbox] = useState(false);
  const { blobUrl, loading, error } = useBlobUrl(url);

  const closeLightbox = useCallback(() => setShowLightbox(false), []);

  if (loading) return <ViewerLoading />;
  if (error || !blobUrl) return <ViewerError fileName={fileName} url={url} />;

  return (
    <>
      <div
        className="relative h-[500px] w-full overflow-hidden rounded-md border border-border bg-muted/30 cursor-pointer group"
        onClick={() => setShowLightbox(true)}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={blobUrl}
          alt={fileName}
          className="absolute top-0 left-0 w-full select-none"
          draggable={false}
        />
        <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/30 transition-colors">
          <ZoomIn className="h-8 w-8 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
      </div>
      {showLightbox && (
        <ImageLightbox blobUrl={blobUrl} fileName={fileName} onClose={closeLightbox} />
      )}
    </>
  );
}

function PdfLightbox({ blobUrl, fileName, onClose }: { blobUrl: string; fileName: string; onClose: () => void }) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCloseRef.current();
    }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute top-4 right-4 z-10 rounded-full bg-card/80 p-2 text-foreground hover:bg-card transition-colors"
      >
        <X className="h-5 w-5" />
      </button>
      <p className="absolute top-4 left-4 text-sm text-white/70 select-none">{fileName}</p>
      <iframe
        src={`${blobUrl}#view=FitH`}
        className="h-[90vh] w-[90vw] rounded-md"
        title={fileName}
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

function PdfViewer({ url, fileName }: { url: string; fileName: string }) {
  const [showLightbox, setShowLightbox] = useState(false);
  const { blobUrl, loading, error } = useBlobUrl(url);

  const closeLightbox = useCallback(() => setShowLightbox(false), []);

  if (loading) return <ViewerLoading />;
  if (error || !blobUrl) return <ViewerError fileName={fileName} url={url} />;

  return (
    <>
      <div
        className="relative h-[500px] w-full overflow-hidden rounded-md border border-border cursor-pointer group"
        onClick={() => setShowLightbox(true)}
      >
        <iframe
          src={`${blobUrl}#view=FitH&toolbar=0`}
          className="h-full w-full pointer-events-none"
          title={fileName}
        />
        <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/30 transition-colors">
          <ZoomIn className="h-8 w-8 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
      </div>
      {showLightbox && (
        <PdfLightbox blobUrl={blobUrl} fileName={fileName} onClose={closeLightbox} />
      )}
    </>
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
        <InlineFileViewer
          key={selectedFile.id}
          url={fileUrl(portalId, sessionId, itemId, selectedFile.id)}
          mimeType={selectedFile.mimeType}
          fileName={selectedFile.fileName}
        />
      )}
    </div>
  );
}
