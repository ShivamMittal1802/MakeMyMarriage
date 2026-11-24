import "server-only";
import { z } from "zod";
import { openPayload, sealPayload } from "@/lib/security/crypto";
import { AppError } from "@/lib/http/errors";
import { objectIdSchema } from "./schemas";

const positionSchema = z.strictObject({
  id: objectIdSchema,
  date: z.iso.datetime(),
  expires: z.number().int(),
});
export function invalidCursor() {
  return new AppError(
    400,
    "INVALID_CURSOR",
    "This list has changed or expired. Refresh to start again.",
  );
}
export function readPosition(cursor: string | undefined, scope: string) {
  if (!cursor) return null;
  try {
    if (!/^[A-Za-z0-9_-]{1,2048}$/.test(cursor)) throw invalidCursor();
    const envelope = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    );
    const position = positionSchema.parse(
      openPayload(envelope, `team-list:${scope}`),
    );
    if (position.expires <= Date.now()) throw invalidCursor();
    return position;
  } catch {
    throw invalidCursor();
  }
}
export function writePosition(id: string, date: Date, scope: string) {
  return Buffer.from(
    JSON.stringify(
      sealPayload(
        {
          id,
          date: date.toISOString(),
          expires: Date.now() + 60 * 60_000,
        },
        `team-list:${scope}`,
      ),
    ),
  ).toString("base64url");
}
