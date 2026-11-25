import { z } from "zod";
import { expectedVersionSchema } from "@/modules/weddings/schemas";
const instant = z.iso.datetime({ offset: true });
export const createEventSchema = z.strictObject({
  name: z.string().trim().min(1).max(150),
  startsAt: instant,
  endsAt: instant.optional(),
  location: z.string().trim().min(1).max(500),
  description: z.string().trim().max(5000).optional(),
});
export const patchEventSchema = createEventSchema
  .partial()
  .extend({
    expectedVersion: expectedVersionSchema,
    endsAt: instant.nullable().optional(),
    description: z.string().trim().max(5000).nullable().optional(),
  })
  .refine(
    (v) => Object.keys(v).length > 1,
    "Choose an event detail to update.",
  );
export const eventListSchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().min(1).max(2048).optional(),
});
export type ScheduleEvent = {
  id: string;
  weddingId: string;
  name: string;
  location: string;
  startsAt: string;
  endsAt?: string;
  description?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};
