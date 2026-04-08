import { useCallback } from "react";

export function useDownloadFill(sessionId: string) {
  return useCallback(async () => {
    const res = await fetch(`/api/sessions/${sessionId}/fill/download`);
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download =
      res.headers
        .get("Content-Disposition")
        ?.split("filename=")[1]
        ?.replace(/"/g, "") ?? "filled-document";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }, [sessionId]);
}
