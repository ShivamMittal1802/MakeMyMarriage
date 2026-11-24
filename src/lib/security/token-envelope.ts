import "server-only";
import { Schema } from "mongoose";
import { openPayload, randomToken, sealPayload, tokenHash } from "./crypto";

export const tokenEnvelopeSchema = new Schema(
  {
    hash: { type: String, required: true },
    ciphertext: { type: String, required: true },
    keyId: { type: String, required: true },
    nonce: { type: String, required: true },
    tag: { type: String, required: true },
    version: { type: Number, required: true, default: 0 },
    issuedAt: { type: Date, required: true },
  },
  { _id: false },
);
export function issueRecoverableToken(context: string) {
  const raw = randomToken();
  return {
    hash: tokenHash(raw),
    ...sealPayload({ token: raw }, context),
    version: 0,
    issuedAt: new Date(),
  };
}
export function recoverToken(
  envelope: Parameters<typeof openPayload>[0],
  context: string,
) {
  return openPayload<{ token: string }>(envelope, context).token;
}
