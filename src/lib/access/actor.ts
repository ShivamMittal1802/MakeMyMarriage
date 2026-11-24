import "server-only";
import { currentAccount } from "./account";
import { AppError } from "@/lib/http/errors";
export async function currentActor() {
  const user = await currentAccount();
  if (!user)
    throw new AppError(401, "AUTHENTICATION_REQUIRED", "Log in to continue.");
  return { id: String(user._id), sessionVersion: user.sessionVersion };
}
