import type { NextRequest } from "next/server";
import { z } from "zod";
import { AppError } from "./errors";
export function query<T>(request: NextRequest, schema: z.ZodType<T>): T {
  const values: Record<string, string> = {};
  for (const [key, value] of request.nextUrl.searchParams) {
    if (key in values)
      throw new AppError(
        422,
        "VALIDATION_ERROR",
        "Query parameters must not be repeated.",
      );
    values[key] = value;
  }
  if (
    "cursor" in values &&
    (!values.cursor.length || values.cursor.length > 2048)
  )
    throw new AppError(400, "INVALID_CURSOR", "Refresh to restart the list.");
  const parsed = schema.safeParse(values);
  if (!parsed.success)
    throw new AppError(
      422,
      "VALIDATION_ERROR",
      "Check the list or version parameters.",
    );
  return parsed.data;
}
export const versionQuery = z.strictObject({
  expectedVersion: z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .pipe(z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)),
});
