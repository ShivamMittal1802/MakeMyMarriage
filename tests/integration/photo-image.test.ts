import { afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { validatePhoto } from "@/modules/gallery/image";
import {
  storageConfigured,
  storageConfig,
  signUpload,
  signRead,
} from "@/lib/providers/r2";
afterEach(() => vi.unstubAllEnvs());
describe("photo validation and capability signing", () => {
  it("decodes allowed images, generates a bounded WebP preview and preserves source bytes", async () => {
    for (const format of ["jpeg", "png", "webp"] as const) {
      const bytes = await sharp({
          create: {
            width: 2200,
            height: 100,
            channels: 3,
            background: "#ac587d",
          },
        })
          [format]()
          .toBuffer(),
        before = Buffer.from(bytes);
      const result = await validatePhoto(bytes, `image/${format}`),
        metadata = await sharp(result.preview).metadata();
      expect(result).toMatchObject({
        width: 2200,
        height: 100,
        mime: `image/${format}`,
      });
      expect(metadata.format).toBe("webp");
      expect(metadata.width).toBe(1600);
      expect(bytes).toEqual(before);
    }
  });
  it("rejects corrupt bytes, forged MIME, unsupported formats and pixel bombs", async () => {
    await expect(
      validatePhoto(Buffer.from("not an image"), "image/jpeg"),
    ).rejects.toMatchObject({ code: "INVALID_IMAGE" });
    const png = await sharp({
      create: { width: 10, height: 10, channels: 3, background: "red" },
    })
      .png()
      .toBuffer();
    await expect(validatePhoto(png, "image/jpeg")).rejects.toMatchObject({
      code: "INVALID_IMAGE",
    });
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" /></svg>',
    );
    await expect(validatePhoto(svg, "image/png")).rejects.toMatchObject({
      code: "INVALID_IMAGE",
    });
    const large = await sharp({
      create: { width: 6400, height: 6400, channels: 3, background: "black" },
    })
      .png()
      .toBuffer();
    await expect(validatePhoto(large, "image/png")).rejects.toMatchObject({
      code: "INVALID_IMAGE",
    });
  });
  it("fails closed with absent storage configuration", () => {
    vi.stubEnv("R2_ACCOUNT_ID", "");
    expect(storageConfigured()).toBe(false);
    expect(storageConfig).toThrow("Photo storage isn’t configured yet");
  });
  it("binds PUT signatures to content length/type and keeps downloads short-lived", async () => {
    for (const [key, value] of Object.entries({
      R2_ACCOUNT_ID: "a".repeat(32),
      R2_BUCKET_NAME: "isolated-test",
      R2_ACCESS_KEY_ID: "test-access",
      R2_SECRET_ACCESS_KEY: "test-secret",
      STORAGE_LIMIT_BYTES: "8000000000",
      MAX_PHOTO_BYTES: "20000000",
    }))
      vi.stubEnv(key, value);
    const ticket = await signUpload(
        "weddings/test/photos/test/staging",
        "image/jpeg",
        100,
        60,
      ),
      url = new URL(ticket.url);
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toContain(
      "content-length",
    );
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toContain(
      "content-type",
    );
    expect(url.searchParams.get("X-Amz-Expires")).toBe("60");
    expect(ticket.headers).toEqual({ "Content-Type": "image/jpeg" });
    const read = new URL((await signRead("test/original", "ceremony.jpg")).url);
    expect(read.searchParams.get("X-Amz-Expires")).toBe("120");
    expect(read.searchParams.get("response-content-disposition")).toContain(
      "attachment;",
    );
    expect(read.searchParams.get("response-cache-control")).toBe(
      "private, no-store",
    );
  });
});
