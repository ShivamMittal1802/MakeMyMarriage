export class ApiClientError extends Error {
  constructor(
    public code: string,
    message: string,
    public fields: { path: string; message: string }[] = [],
  ) {
    super(message);
  }
}
export async function getResponse<T>(path: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { cache: "no-store" });
  } catch {
    throw new ApiClientError(
      "REQUEST_UNCONFIRMED",
      "We couldn’t confirm the request. Check your connection and try again.",
    );
  }
  const result = await response.json().catch(() => null);
  if (!response.ok || !result)
    throw new ApiClientError(
      result?.error?.code ?? "REQUEST_UNCONFIRMED",
      result?.error?.message ?? "We couldn’t confirm the request.",
      result?.error?.details?.fields ?? [],
    );
  return result as T;
}
export async function getJson<T>(path: string): Promise<T> {
  return (await getResponse<{ data: T }>(path)).data;
}
export async function mutateJson<T>(
  path: string,
  method: "POST" | "PATCH" | "DELETE",
  body?: unknown,
  idempotencyKey?:string,
): Promise<T> {
  const csrf = await getJson<{ csrfToken: string }>("/api/v1/csrf");
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(idempotencyKey ? {"Idempotency-Key":idempotencyKey}:{}),
        "X-CSRF-Token": csrf.csrfToken,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiClientError(
      "REQUEST_UNCONFIRMED",
      "We couldn’t confirm whether the request finished. Check its status before trying again.",
    );
  }
  if (response.status === 204) return undefined as T;
  const result = await response.json().catch(() => null);
  if (!response.ok || !result)
    throw new ApiClientError(
      result?.error?.code ?? "REQUEST_UNCONFIRMED",
      result?.error?.message ??
        "We couldn’t confirm whether the request finished.",
      result?.error?.details?.fields ?? [],
    );
  return result.data as T;
}
export function postJson<T>(path: string, body: unknown): Promise<T> {
  return mutateJson(path, "POST", body);
}
