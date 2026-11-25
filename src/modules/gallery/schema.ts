import { z } from "zod";
export const purposeSchema = z.enum(["upload", "view"]);
export type Purpose = z.infer<typeof purposeSchema>;
export const uploadSchema = z.strictObject({
  filename: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .transform((v) => v.replace(/[\\/\x00-\x1f\x7f]/g, "_").slice(0, 150)),
  contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  sizeBytes: z.number().int().min(1).max(20_000_000),
});
export type UploadInput = z.infer<typeof uploadSchema>;
export type UploadStatus = {
  photoId: string;
  state: string;
  failureCode?: string;
  canRetryComplete: boolean;
  retryAfterSeconds?: number;
};
export type UploadTicket = UploadStatus & {
  upload?: {
    method: "PUT";
    url: string;
    headers: Record<string, string>;
    expiresAt: string;
  };
  statusUrl: string;
  completeUrl: string;
};
export type GalleryPhoto = {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  width: number;
  height: number;
  createdAt: string;
  version: number;
  preview: { url: string; expiresAt: string };
};
export type PhotoPage = {
  data: GalleryPhoto[];
  page: { limit: number; nextCursor: string | null; hasMore: boolean };
};
