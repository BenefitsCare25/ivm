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
      };
    };
  }
}

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

export async function detectExtension(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (!window.chrome?.runtime?.sendMessage) return false;
  if (!EXTENSION_ID) return false;
  try {
    const response = await sendMessageToExtension<ExtensionPingResponse>({
      type: "IVM_PING",
    });
    return response?.installed === true;
  } catch {
    return false;
  }
}

export async function sendFillToExtension(
  targetUrl: string,
  script: string,
  sessionId?: string
): Promise<ExtensionFillResponse> {
  return sendMessageToExtension<ExtensionFillResponse>({
    type: "IVM_FILL",
    targetUrl,
    script,
    sessionId,
  });
}

export interface ExtensionCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
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
 * Used by Portal Tracker to reuse authenticated sessions.
 */
export async function captureCookiesFromExtension(
  targetUrl: string
): Promise<ExtensionCookie[]> {
  const response = await sendMessageToExtension<ExtensionCookieResponse>({
    type: "IVM_CAPTURE_COOKIES",
    targetUrl,
  });

  if (!response?.success) {
    throw new Error(response?.error ?? "Failed to capture cookies");
  }

  return response.cookies ?? [];
}
