import "server-only";
import { Readable } from "node:stream";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { z } from "zod";
import { AppError } from "@/lib/http/errors";
const configSchema = z.object({
  account: z.string().regex(/^[a-f0-9]{32}$/),
  bucket: z.string().min(3),
  access: z.string().min(1),
  secret: z.string().min(1),
  limit: z.coerce.number().int().positive().max(8_000_000_000),
  maxPhoto: z.coerce.number().int().positive().max(20_000_000),
});
export function storageConfig() {
  const result = configSchema.safeParse({
    account: process.env.R2_ACCOUNT_ID,
    bucket: process.env.R2_BUCKET_NAME,
    access: process.env.R2_ACCESS_KEY_ID,
    secret: process.env.R2_SECRET_ACCESS_KEY,
    limit: process.env.STORAGE_LIMIT_BYTES || 8_000_000_000,
    maxPhoto: process.env.MAX_PHOTO_BYTES || 20_000_000,
  });
  if (!result.success)
    throw new AppError(
      503,
      "STORAGE_NOT_CONFIGURED",
      "Photo storage isn’t configured yet. Please try again after setup is complete.",
    );
  return result.data;
}
export function storageConfigured() {
  try {
    storageConfig();
    return true;
  } catch {
    return false;
  }
}
function connection() {
  const c = storageConfig();
  return {
    bucket: c.bucket,
    client: new S3Client({
      region: "auto",
      endpoint: `https://${c.account}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: c.access, secretAccessKey: c.secret },
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
      maxAttempts: 1,
    }),
  };
}
export async function signUpload(
  key: string,
  mime: string,
  size: number,
  expiresIn: number,
) {
  const { client, bucket } = connection();
  const url = await getSignedUrl(
    client,
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: mime,
      ContentLength: size,
    }),
    { expiresIn, signableHeaders: new Set(["content-type", "content-length"]) },
  );
  return {
    method: "PUT" as const,
    url,
    headers: { "Content-Type": mime },
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
  };
}
export async function signRead(key: string, filename?: string) {
  const { client, bucket } = connection();
  return {
    url: await getSignedUrl(
      client,
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
        ResponseCacheControl: "private, no-store",
        ...(filename && {
          ResponseContentDisposition: `attachment; filename="photo"; filename*=UTF-8''${encodeURIComponent(filename).replace(/'/g, "%27")}`,
        }),
      }),
      { expiresIn: 120 },
    ),
    expiresAt: new Date(Date.now() + 120_000).toISOString(),
  };
}
export async function readObject(
  key: string,
  max: number,
  signal: AbortSignal,
) {
  const { client, bucket } = connection();
  const value = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
    { abortSignal: signal },
  );
  if (!value.Body) throw new Error("Missing object body");
  if ((value.ContentLength ?? Infinity) > max) {
    if (value.Body instanceof Readable) value.Body.destroy();
    throw new AppError(
      413,
      "PHOTO_TOO_LARGE",
      "This photo exceeds the upload limit.",
    );
  }
  const parts: Buffer[] = [];
  let size = 0;
  for await (const chunk of value.Body as AsyncIterable<Uint8Array>) {
    size += chunk.length;
    if (size > max) {
      if (value.Body instanceof Readable) value.Body.destroy();
      throw new AppError(
        413,
        "PHOTO_TOO_LARGE",
        "This photo exceeds the upload limit.",
      );
    }
    parts.push(Buffer.from(chunk));
  }
  return { bytes: Buffer.concat(parts), etag: value.ETag };
}
export function missingObject(e: unknown) {
  return (
    !!e &&
    typeof e === "object" &&
    "name" in e &&
    ["NoSuchKey", "NotFound"].includes(String(e.name))
  );
}
export async function putFinal(
  key: string,
  bytes: Buffer,
  mime: string,
  signal: AbortSignal,
) {
  const { client, bucket } = connection();
  try {
    return await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: bytes,
        ContentType: mime,
        IfNoneMatch: "*",
        CacheControl: "private, no-store",
      }),
      { abortSignal: signal },
    );
  } catch (e) {
    if (
      e &&
      typeof e === "object" &&
      "name" in e &&
      e.name === "PreconditionFailed"
    )
      return;
    throw e;
  }
}
export async function removeObject(key: string) {
  const { client, bucket } = connection(),
    signal = AbortSignal.timeout(10_000);
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }), {
    abortSignal: signal,
  });
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }), {
      abortSignal: signal,
    });
  } catch (e) {
    if (missingObject(e)) return;
    throw e;
  }
  throw new Error("Deletion not confirmed");
}
