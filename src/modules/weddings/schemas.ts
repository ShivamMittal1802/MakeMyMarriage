import { z } from "zod";
import { emailSchema } from "@/modules/identity/schemas";

export const roleSchema = z.enum(["bride", "groom", "manager"]);
export const objectIdSchema = z.string().regex(/^[a-fA-F0-9]{24}$/);
export const weddingDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a valid wedding date.")
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return (
      Number.isFinite(date.getTime()) &&
      date.toISOString().slice(0, 10) === value
    );
  }, "Choose a valid calendar date.");
export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "Use at least 3 characters.")
  .max(80)
  .regex(/^[a-z0-9-]+$/, "Use lowercase letters, numbers, and hyphens.");
export const weddingCreateSchema = z.strictObject({
  couple: z.strictObject({
    brideName: z.string().trim().min(1, "Enter the bride’s name.").max(150),
    groomName: z.string().trim().min(1, "Enter the groom’s name.").max(150),
  }),
  weddingDate: weddingDateSchema,
  location: z.string().trim().min(1, "Enter the wedding location.").max(500),
  slug: slugSchema,
  introduction: z.string().trim().max(5000).optional(),
  creatorRole: roleSchema.default("manager"),
});
export const memberInviteSchema = z.strictObject({
  email: emailSchema,
  role: roleSchema,
});
export const invitationExchangeSchema = z.strictObject({
  token: z
    .string()
    .regex(/^[A-Za-z0-9_-]{43}$/, "This invitation link is incomplete."),
});
export const emptyBodySchema = z.strictObject({});
export const expectedVersionSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);
export function youtubeVideoId(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port)
    return undefined;
  const path = url.pathname.replace(/\/$/, "");
  let candidate: string | null | undefined;
  if (url.hostname === "youtu.be") candidate = path.slice(1);
  else if (
    ["youtube.com", "www.youtube.com", "m.youtube.com"].includes(url.hostname)
  ) {
    candidate =
      path === "/watch"
        ? url.searchParams.get("v")
        : /^\/(?:live|embed|shorts)\/([^/]+)$/.exec(path)?.[1];
  }
  return candidate && /^[A-Za-z0-9_-]{11}$/.test(candidate)
    ? candidate
    : undefined;
}
export const weddingPatchSchema = weddingCreateSchema
  .pick({
    couple: true,
    weddingDate: true,
    location: true,
    introduction: true,
  })
  .partial()
  .extend({
    expectedVersion: expectedVersionSchema,
    youtubeUrl: z
      .string()
      .trim()
      .max(2048)
      .refine(
        (value) => !!youtubeVideoId(value),
        "Enter a YouTube video or livestream link.",
      )
      .nullable()
      .optional(),
  })
  .refine(
    (value) => Object.keys(value).length > 1,
    "Choose at least one detail to change.",
  );
export type WeddingPatch = z.infer<typeof weddingPatchSchema>;
export const memberRolePatchSchema = z.strictObject({
  expectedVersion: expectedVersionSchema,
  role: roleSchema,
});
export const memberListSchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().min(1).max(2048).optional(),
  status: z.enum(["active", "revoked"]).default("active"),
});
export const invitationListSchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().min(1).max(2048).optional(),
  status: z
    .enum(["pending", "accepted", "revoked", "expired"])
    .default("pending"),
});
export type ListPage<T> = {
  data: T[];
  page: { limit: number; nextCursor: string | null; hasMore: boolean };
};
export type MemberDto = {
  id: string;
  userId: string;
  name: string;
  role: MemberRole;
  isOwner: boolean;
  status: "active" | "revoked";
  joinedAt: string;
  version: number;
  revokedAt?: string;
  revokedBy?: string;
};
export type WeddingCreate = z.infer<typeof weddingCreateSchema>;
export type MemberRole = z.infer<typeof roleSchema>;
export type WeddingDto = {
  id: string;
  ownerUserId: string;
  slug: string;
  couple: { brideName: string; groomName: string };
  weddingDate: string;
  location: string;
  introduction?: string;
  timezone: "Asia/Kolkata";
  currency: "INR";
  youtubeVideoId?: string;
  publicUrl: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};
export type InviteDto = {
  id: string;
  weddingId: string;
  email: string;
  role: MemberRole;
  status: "pending" | "accepted" | "revoked" | "expired";
  expiresAt: string;
  acceptedAt?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};
export type InviteContext = {
  invitationId: string;
  couple: { brideName: string; groomName: string };
  role: MemberRole;
  expiresAt: string;
  cleanPath: string;
};
