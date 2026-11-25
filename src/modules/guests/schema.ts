import { z } from "zod";
import { emailSchema } from "@/modules/identity/schemas";
import {
  expectedVersionSchema,
  objectIdSchema,
} from "@/modules/weddings/schemas";
import { eventListSchema } from "@/modules/events/schema";
export const guestCreate = z.strictObject({
  name: z.string().trim().min(1, "Enter the guest’s name.").max(150),
  email: emailSchema.optional(),
  phone: z.string().trim().min(1).max(32).optional(),
});
export const guestPatch = guestCreate
  .partial()
  .extend({
    email: emailSchema.nullable().optional(),
    phone: guestCreate.shape.phone.nullable(),
    expectedVersion: expectedVersionSchema,
  })
  .refine((x) => Object.keys(x).length > 1);
export const guestQuery = eventListSchema.extend({
  q: z.string().trim().max(150).optional(),
});
export const selectEvent = z.strictObject({
  guestId: objectIdSchema,
  eventId: objectIdSchema,
});
export const versionBody = z.strictObject({
  expectedVersion: expectedVersionSchema,
});
export const selectionQuery = eventListSchema.extend({
  guestId: objectIdSchema.optional(),
  eventId: objectIdSchema.optional(),
  status: z.enum(["active", "revoked"]).default("active"),
  rsvp: z.enum(["pending", "attending", "declined"]).optional(),
});
