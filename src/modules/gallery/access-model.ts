import "server-only";
import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import { commonFields, modelOptions } from "@/lib/db/connection";
import { tokenEnvelopeSchema } from "@/lib/security/token-envelope";
const schema = new Schema(
  {
    ...commonFields,
    weddingId: { type: Schema.Types.ObjectId, required: true },
    purpose: { type: String, enum: ["upload", "view"], required: true },
    token: { type: tokenEnvelopeSchema, required: true, select: false },
    status: {
      type: String,
      enum: ["active", "revoked"],
      required: true,
      default: "active",
    },
  },
  modelOptions("galleryAccess"),
);
schema.index(
  { weddingId: 1, purpose: 1 },
  { name: "uq_gallery_purpose", unique: true },
);
schema.index({ "token.hash": 1 }, { name: "uq_gallery_token", unique: true });
type GalleryAccessRecord = InferSchemaType<typeof schema>;
export const GalleryAccess: Model<GalleryAccessRecord> =
  (mongoose.models.GalleryAccess as Model<GalleryAccessRecord> | undefined) ??
  mongoose.model<GalleryAccessRecord>("GalleryAccess", schema);
