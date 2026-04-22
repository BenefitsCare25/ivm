export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { init } = await import("@sentry/nextjs");
    init({
      dsn: process.env.SENTRY_DSN,
      enabled: !!process.env.SENTRY_DSN,
      tracesSampleRate: 0.1,
      debug: false,
    });
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    const { init } = await import("@sentry/nextjs");
    init({
      dsn: process.env.SENTRY_DSN,
      enabled: !!process.env.SENTRY_DSN,
      tracesSampleRate: 0.1,
      debug: false,
    });
  }
}

export async function onRequestError(
  error: { digest: string } & Error,
  request: { path: string; method: string; headers: Record<string, string | string[] | undefined> },
  context: { routerKind: string; routePath: string; routeType: string }
) {
  const { captureRequestError } = await import("@sentry/nextjs");
  captureRequestError(error, request, context);
}
