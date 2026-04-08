"use client";

import { useState } from "react";
import { Copy, Check, ExternalLink, Bookmark } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

interface WebpageFillScriptProps {
  script: string;
  targetUrl: string | null;
  onExtensionFill?: () => void;
  extensionDetected?: boolean;
}

const BOOKMARKLET_MAX_LENGTH = 2000;

function generateBookmarklet(script: string): string | null {
  const encoded = `javascript:void(${encodeURIComponent(`(function(){${script}})()`)})`;
  return encoded.length <= BOOKMARKLET_MAX_LENGTH ? encoded : null;
}

export function WebpageFillScript({
  script,
  targetUrl,
  onExtensionFill,
  extensionDetected,
}: WebpageFillScriptProps) {
  const [copied, setCopied] = useState(false);
  const [openedAndCopied, setOpenedAndCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(script);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleOpenAndCopy = async () => {
    await navigator.clipboard.writeText(script);
    if (targetUrl) {
      window.open(targetUrl, "_blank");
    }
    setOpenedAndCopied(true);
    setTimeout(() => setOpenedAndCopied(false), 3000);
  };

  const bookmarkletUrl = generateBookmarklet(script);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium">Fill Script</CardTitle>
          <div className="flex items-center gap-2">
            {extensionDetected && onExtensionFill && (
              <Button size="sm" onClick={onExtensionFill}>
                Fill with Extension
              </Button>
            )}
            {targetUrl && (
              <Button size="sm" onClick={handleOpenAndCopy}>
                {openedAndCopied ? (
                  <>
                    <Check className="mr-2 h-3 w-3" />
                    Opened & Copied
                  </>
                ) : (
                  <>
                    <ExternalLink className="mr-2 h-3 w-3" />
                    Open Target & Copy
                  </>
                )}
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={handleCopy}>
              {copied ? (
                <>
                  <Check className="mr-2 h-3 w-3" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="mr-2 h-3 w-3" />
                  Copy Script
                </>
              )}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="rounded-md border border-border bg-muted/50 p-3 text-xs text-muted-foreground space-y-1.5">
          <p className="font-medium text-foreground/80">How to fill the target page:</p>
          <ol className="list-decimal list-inside space-y-0.5">
            <li>
              Click <span className="font-medium text-foreground/80">Open Target & Copy</span> above
            </li>
            <li>
              On the opened page, press <kbd className="rounded border border-border bg-background px-1 py-0.5 font-mono text-[10px]">F12</kbd> to open DevTools
            </li>
            <li>Click the <span className="font-medium text-foreground/80">Console</span> tab</li>
            <li>
              Paste (<kbd className="rounded border border-border bg-background px-1 py-0.5 font-mono text-[10px]">Ctrl+V</kbd>) and press <kbd className="rounded border border-border bg-background px-1 py-0.5 font-mono text-[10px]">Enter</kbd>
            </li>
          </ol>
          {targetUrl && (
            <p className="pt-1 text-muted-foreground/80">
              Target: <span className="font-mono">{targetUrl}</span>
            </p>
          )}
        </div>

        {bookmarkletUrl && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Bookmark className="h-3 w-3 shrink-0" />
            <span>Alternative: drag this link to your bookmark bar, then click it on the target page:</span>
            <a
              href={bookmarkletUrl}
              className="inline-flex items-center rounded border border-border bg-background px-2 py-0.5 font-medium text-foreground/80 hover:bg-muted no-underline"
              onClick={(e) => e.preventDefault()}
              draggable
            >
              IVM Fill
            </a>
          </div>
        )}
        {!bookmarkletUrl && (
          <p className="text-xs text-muted-foreground/60">
            Script is too large for a bookmarklet. Use the Copy Script method instead.
          </p>
        )}

        <pre className="max-h-[300px] overflow-auto rounded-md bg-muted p-3 font-mono text-xs text-muted-foreground">
          {script}
        </pre>
      </CardContent>
    </Card>
  );
}
