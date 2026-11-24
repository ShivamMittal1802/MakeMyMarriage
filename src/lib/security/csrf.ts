import "server-only";
import Tokens from "@fastify/csrf";
import { NextRequest, NextResponse } from "next/server";
import { appOrigin, authSecret } from "@/lib/config/server";
import { AppError } from "@/lib/http/errors";

function options() {
  const secure = appOrigin().startsWith("https:");
  return {
    secure,
    cookie: secure ? "__Host-mmm.csrf" : "mmm.csrf",
    tokens: new Tokens({
      secretLength: 32,
      hmacKey: authSecret(),
      validity: 60 * 60 * 1000,
    }),
  };
}

export function csrfBootstrap(request: NextRequest) {
  const { cookie, tokens, secure } = options();
  const prior = request.cookies.get(cookie)?.value;
  const secret =
    prior && /^[A-Za-z0-9_-]{43}$/.test(prior) ? prior : tokens.secretSync();
  const response = NextResponse.json({
    data: { csrfToken: tokens.create(secret) },
  });
  response.cookies.set(cookie, secret, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60,
  });
  return response;
}

export function assertCsrf(request: NextRequest) {
  const { cookie, tokens } = options();
  const secret = request.cookies.get(cookie)?.value;
  const token = request.headers.get("x-csrf-token");
  if (
    request.headers.get("origin") !== appOrigin() ||
    request.headers.get("sec-fetch-site") === "cross-site" ||
    !secret ||
    !token ||
    token.length > 256 ||
    !tokens.verify(secret, token)
  )
    throw new AppError(
      403,
      "CSRF_INVALID",
      "Your form expired. Refresh and try again.",
    );
}
