import "server-only";

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function serviceNotConfigured() {
  return new AppError(
    503,
    "SERVICE_NOT_CONFIGURED",
    "Account access is not available yet. Please try again later.",
  );
}

export function dependencyUnavailable() {
  return new AppError(
    503,
    "DEPENDENCY_UNAVAILABLE",
    "Account access is temporarily unavailable. Please try again.",
  );
}
