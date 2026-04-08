"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function DeleteSessionButton({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleDelete() {
    setLoading(true);
    try {
      const res = await fetch(`/api/sessions/${sessionId}`, { method: "DELETE" });
      if (res.ok) router.refresh();
    } finally {
      setLoading(false);
      setConfirming(false);
    }
  }

  if (confirming) {
    return (
      <div className="flex items-center gap-1">
        <Button
          variant="destructive"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={handleDelete}
          disabled={loading}
        >
          {loading ? "Deleting..." : "Confirm"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => setConfirming(false)}
          disabled={loading}
        >
          Cancel
        </Button>
      </div>
    );
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
      onClick={() => setConfirming(true)}
      title="Delete session"
    >
      <Trash2 className="h-3.5 w-3.5" />
    </Button>
  );
}
