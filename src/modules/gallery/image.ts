import "server-only";
import sharp from "sharp";
import { AppError } from "@/lib/http/errors";
export const previewAllowance = 2_000_000;
export async function validatePhoto(bytes: Buffer, declaredMime: string) {
  try {
    const decoder = sharp(bytes, {
      limitInputPixels: 40_000_000,
      failOn: "warning",
      animated: false,
    }).timeout({ seconds: 20 });
    const meta = await decoder.metadata();
    const mime = (
      { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" } as Record<
        string,
        string
      >
    )[meta.format ?? ""];
    if (
      !mime ||
      mime !== declaredMime ||
      !meta.width ||
      !meta.height ||
      (meta.pages ?? 1) > 1
    )
      throw new Error("Invalid image");
    const preview = await decoder
      .rotate()
      .resize({
        width: 1600,
        height: 1600,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 80 })
      .toBuffer();
    if (preview.length > previewAllowance) throw new Error("Preview too large");
    return { mime, width: meta.width, height: meta.height, preview };
  } catch {
    throw new AppError(
      422,
      "INVALID_IMAGE",
      "Use a valid, non-animated JPEG, PNG or WebP photo up to 40 megapixels.",
    );
  }
}
