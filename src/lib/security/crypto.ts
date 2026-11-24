import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { encryptionConfig } from "@/lib/config/server";

export type CipherEnvelope = {
  ciphertext: string;
  keyId: string;
  nonce: string;
  tag: string;
};
export function randomToken() {
  return randomBytes(32).toString("base64url");
}
export function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
export function sealPayload(payload: unknown, context: string): CipherEnvelope {
  const { key, keyId } = encryptionConfig();
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(context));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ]);
  return {
    ciphertext: ciphertext.toString("base64"),
    nonce: nonce.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    keyId,
  };
}
export function openPayload<T>(envelope: CipherEnvelope, context: string): T {
  const { key, keyId } = encryptionConfig();
  if (envelope.keyId !== keyId)
    throw new Error("Payload encryption key unavailable");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(envelope.nonce, "base64"),
  );
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  return JSON.parse(
    Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8"),
  ) as T;
}
