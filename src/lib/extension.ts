import type { WebpageFillOp } from "@/types/fill";

const EXTENSION_ID = process.env.NEXT_PUBLIC_IVM_EXTENSION_ID ?? "";

interface ExtensionPingResponse {
  installed: boolean;
  version: string;
}

interface ExtensionFillResponse {
  success: boolean;
  error?: string;
}

declare global {
  interface Window {
    chrome?: {
      runtime?: {
        sendMessage: (
          extensionId: string,
          message: Record<string, unknown>,
          callback?: (response: unknown) => void
        ) => void;
        lastError?: { message?: string };
      };
    };
  }
}

// ---------- Content script bridge (primary, reliable) ----------
//
// The content script (content.js) is injected into IVM pages by the manifest.
// It listens for CustomEvent "IVM_REQUEST" on window, forwards to the background
// via chrome.runtime.sendMessage (internal — reliable worker wake-up), and
// dispatches "IVM_RESPONSE" back. This avoids the externally_connectable MV3
// service worker termination issues entirely.

let _contentScriptReady: boolean | null = null;

function isContentScriptAvailable(): boolean {
  if (_contentScriptReady !== null) return _contentScriptReady;
  if (typeof window === "undefined") return false;
  // The content script dispatches IVM_CONTENT_SCRIPT_READY on load.
  // We can also detect it by checking for the event listener on window.
  // Simplest: try sending a ping and see if we get a response.
  return true; // Assume available if we're on a matched page; will fail gracefully
}

function sendViaContentScript<T>(message: Record<string, unknown>): Promise<T> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("Not in browser context"));
      return;
    }

    const requestId = Math.random().toString(36).slice(2);

    const timer = setTimeout(() => {
      window.removeEventListener("IVM_RESPONSE", handler);
      _contentScriptReady = false;
      reject(new Error("Content script did not respond"));
    }, 5000);

    function handler(event: Event) {
      const detail = (event as CustomEvent).detail;
      if (!detail || detail._requestId !== requestId) return;

      window.removeEventListener("IVM_RESPONSE", handler);
      clearTimeout(timer);
      _contentScriptReady = true;

      if (detail._error) {
        reject(new Error(detail._error));
        return;
      }

      // Strip internal fields before resolving
      const { _requestId: _, _error: __, ...rest } = detail;
      resolve(rest as T);
    }

    window.addEventListener("IVM_RESPONSE", handler);
    window.dispatchEvent(
      new CustomEvent("IVM_REQUEST", {
        detail: { ...message, _requestId: requestId },
      })
    );
  });
}

// ---------- External messaging (fallback) ----------

function sendMessageToExtension<T>(message: Record<string, unknown>): Promise<T> {
  return new Promise((resolve, reject) => {
    if (!window.chrome?.runtime?.sendMessage) {
      reject(new Error("Chrome extension API not available"));
      return;
    }
    if (!EXTENSION_ID) {
      reject(new Error("Extension ID not configured"));
      return;
    }
    try {
      window.chrome.runtime.sendMessage(EXTENSION_ID, message, (response) => {
        const lastError = (window.chrome?.runtime as { lastError?: { message?: string } })?.lastError;
        if (lastError) {
          reject(new Error(lastError.message ?? "Unknown extension error"));
          return;
        }
        resolve(response as T);
      });
    } catch {
      reject(new Error("Failed to communicate with extension"));
    }
  });
}

// ---------- Public API ----------

export async function detectExtension(): Promise<boolean> {
  if (typeof window === "undefined") return false;

  // Try content script first — works without EXTENSION_ID (uses window.postMessage)
  try {
    const response = await sendViaContentScript<ExtensionPingResponse>({
      type: "IVM_PING",
    });
    if (response?.installed) return true;
  } catch {
    // Content script not available, try external messaging
  }

  // Fallback: external messaging (requires EXTENSION_ID)
  if (!EXTENSION_ID || !window.chrome?.runtime?.sendMessage) return false;
  try {
    const response = await sendMessageToExtension<ExtensionPingResponse>({
      type: "IVM_PING",
    });
    return response?.installed === true;
  } catch {
    return false;
  }
}

/** Fetch a signed extension token from the server for popup auth */
async function fetchExtensionToken(): Promise<string | null> {
  try {
    const res = await fetch("/api/auth/extension-token");
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data.token === "string" ? data.token : null;
  } catch {
    return null;
  }
}

/** Store IVM base URL and signed extension token in extension storage so the popup can auth */
export async function syncExtensionConfig(): Promise<void> {
  if (typeof window === "undefined") return;
  const token = await fetchExtensionToken();
  const message: Record<string, unknown> = {
    type: "IVM_SYNC_CONFIG",
    ivmBaseUrl: window.location.origin,
  };
  if (token) message.ivmExtensionToken = token;
  try {
    await sendViaContentScript<{ ok: boolean }>(message);
  } catch {
    try {
      await sendMessageToExtension<{ ok: boolean }>(message);
    } catch {
      // Non-critical
    }
  }
}

export async function sendFillToExtension(
  targetUrl: string,
  script: string,
  sessionId?: string,
  operations?: WebpageFillOp[]
): Promise<ExtensionFillResponse> {
  return sendMessageToExtension<ExtensionFillResponse>({
    type: "IVM_FILL",
    targetUrl,
    script,
    operations: operations ?? [],
    sessionId,
  });
}

/** Map Chrome extension sameSite values to the format expected by the Zod schema */
export function mapSameSite(v?: string): "Strict" | "Lax" | "None" | undefined {
  switch (v) {
    case "strict": return "Strict";
    case "lax": return "Lax";
    case "no_restriction": return "None";
    default: return undefined;
  }
}

/** Transform Chrome extension cookies to the format expected by the save API */
export function mapChromeCookies(cookies: ExtensionCookie[]) {
  return cookies.map((c) => ({
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path || "/",
    expires: c.expires ?? c.expirationDate,
    httpOnly: c.httpOnly,
    secure: c.secure,
    sameSite: mapSameSite(c.sameSite),
  }));
}

export interface ExtensionCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  expirationDate?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "unspecified" | "no_restriction" | "lax" | "strict";
}

interface ExtensionCookieResponse {
  success: boolean;
  cookies?: ExtensionCookie[];
  error?: string;
}

/**
 * Captures cookies from the user's browser for a given URL via Chrome Extension.
 *
 * Primary: content script bridge (DOM events → internal messaging → background).
 * Reliable because content scripts are always alive and internal sendMessage
 * handles MV3 service worker wake-up correctly.
 *
 * Fallback: external messaging with retry for MV3 worker wake-up race.
 */
export async function captureCookiesFromExtension(
  targetUrl: string
): Promise<ExtensionCookie[]> {
  const message = { type: "IVM_CAPTURE_COOKIES", targetUrl };

  // Primary: content script (reliable)
  try {
    const response = await sendViaContentScript<ExtensionCookieResponse>(message);
    if (!response?.success) {
      throw new Error(response?.error ?? "Failed to capture cookies");
    }
    return response.cookies ?? [];
  } catch (csErr) {
    const csMsg = csErr instanceof Error ? csErr.message : "";
    // If content script isn't available, fall through to external messaging
    if (!csMsg.includes("Content script did not respond")) {
      throw csErr; // Real error from background (e.g., cookies API failure)
    }
  }

  // Fallback: external messaging with retry
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
    try {
      const response = await sendMessageToExtension<ExtensionCookieResponse>(message);
      if (!response?.success) {
        throw new Error(response?.error ?? "Failed to capture cookies");
      }
      return response.cookies ?? [];
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const msg = lastError.message;
      if (!msg.includes("port closed") && !msg.includes("does not exist") && !msg.includes("Receiving end")) {
        throw lastError; // Non-transient error
      }
    }
  }

  throw new Error(
    "Could not communicate with extension. Please reload it in chrome://extensions and try again."
  );
}
