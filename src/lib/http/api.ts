import "server-only";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { AppError } from "./errors";

export async function api(
  action: (requestId: string) => Promise<Response>,
): Promise<Response> {
  const requestId = randomUUID();
  let response: Response;
  try {
    response = await action(requestId);
  } catch (error) {
    const failure =
      error instanceof AppError
        ? error
        : new AppError(
            500,
            "INTERNAL_ERROR",
            "Something went wrong. Please try again.",
          );
    // Deliberately do not log request bodies, URLs, email addresses, or provider errors.
    if (!(error instanceof AppError))
      console.error("identity_request_failed", {
        requestId,
        code: failure.code,
      });
    response = NextResponse.json(
      {
        error: {
          code: failure.code,
          message: failure.message,
          ...(failure.details ? { details: failure.details } : {}),
        },
        requestId,
      },
      { status: failure.status },
    );
    if (
      failure.status === 429 &&
      typeof failure.details?.retryAfterSeconds === "number"
    )
      response.headers.set(
        "Retry-After",
        String(failure.details.retryAfterSeconds),
      );
  }
  response.headers.set("X-Request-Id", requestId);
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

export function success(data: unknown, status = 200) {
  return NextResponse.json({ data }, { status });
}

export async function readJson<T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<T> {
  if (
    request.headers.get("content-type")?.split(";")[0].trim() !==
    "application/json"
  )
    throw new AppError(
      415,
      "UNSUPPORTED_MEDIA_TYPE",
      "Use an application/json request.",
    );
  const maxBytes = 256 * 1024;
  const declared = Number(request.headers.get("content-length"));
  if (declared > maxBytes)
    throw new AppError(413, "REQUEST_TOO_LARGE", "This request is too large.");
  const reader = request.body?.getReader();
  if (!reader) throw new AppError(400, "MALFORMED_JSON", "Enter valid JSON.");
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new AppError(
          413,
          "REQUEST_TOO_LARGE",
          "This request is too large.",
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  let body: unknown;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new AppError(400, "MALFORMED_JSON", "Enter valid JSON.");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success)
    throw new AppError(
      422,
      "VALIDATION_ERROR",
      "Check the information you entered.",
      {
        fields: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
    );
  return parsed.data;
}
