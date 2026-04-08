"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

interface WebpageFillScriptProps {
  script: string;
  targetUrl: string | null;
}

export function WebpageFillScript({ script, targetUrl }: WebpageFillScriptProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(script);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium">Fill Script</CardTitle>
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
        {targetUrl && (
          <p className="text-xs text-muted-foreground">
            Open{" "}
            <span className="font-mono text-foreground/80">{targetUrl}</span>{" "}
            in your browser, then paste this script into the DevTools console
            (F12).
          </p>
        )}
      </CardHeader>
      <CardContent>
        <pre className="max-h-[300px] overflow-auto rounded-md bg-muted p-3 font-mono text-xs text-muted-foreground">
          {script}
        </pre>
      </CardContent>
    </Card>
  );
}
