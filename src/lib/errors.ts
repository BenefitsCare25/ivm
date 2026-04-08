export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(message: string, statusCode = 500, code = "INTERNAL_ERROR") {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id?: string) {
    const msg = id ? `${resource} '${id}' not found` : `${resource} not found`;
    super(msg, 404, "NOT_FOUND");
    this.name = "NotFoundError";
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Authentication required") {
    super(message, 401, "UNAUTHORIZED");
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Access denied") {
    super(message, 403, "FORBIDDEN");
    this.name = "ForbiddenError";
  }
}

export class ValidationError extends AppError {
  public readonly fieldErrors: Record<string, string[]>;

  constructor(
    message: string,
    fieldErrors: Record<string, string[]> = {}
  ) {
    super(message, 400, "VALIDATION_ERROR");
    this.name = "ValidationError";
    this.fieldErrors = fieldErrors;
  }
}

export function errorResponse(err: unknown): Response {
  const { NextResponse } = require("next/server");
  if (err instanceof ValidationError) {
    return NextResponse.json(
      { error: err.message, code: err.code, details: err.fieldErrors },
      { status: err.statusCode }
    );
  }
  if (err instanceof AppError) {
    // Only capture 5xx errors in Sentry — 4xx are expected client errors
    if (err.statusCode >= 500) {
      try {
        const Sentry = require("@sentry/nextjs");
        Sentry.captureException(err);
      } catch {
        // Sentry not configured — ignore
      }
    }
    return NextResponse.json(
      { error: err.message, code: err.code },
      { status: err.statusCode }
    );
  }
  // Unhandled/unknown errors — always capture
  try {
    const Sentry = require("@sentry/nextjs");
    Sentry.captureException(err);
  } catch {
    // Sentry not configured — ignore
  }
  const { logger } = require("@/lib/logger");
  logger.error({ err }, "Unhandled error");
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}
