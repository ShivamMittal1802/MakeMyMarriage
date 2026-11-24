import "server-only";
import { hash, verify } from "@node-rs/argon2";

const options = {
  algorithm: 2 /* Argon2id; numeric enum avoids ambient const-enum access with isolatedModules */,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
};
let dummyHash: Promise<string> | undefined;
export function hashPassword(password: string) {
  return hash(password, options);
}
export async function verifyPassword(password: string, encoded?: string) {
  dummyHash ??= hashPassword("dummy-password-never-used-for-an-account");
  const candidate = encoded ?? (await dummyHash);
  try {
    const valid = await verify(candidate, password);
    return !!encoded && valid;
  } catch {
    return false;
  }
}
