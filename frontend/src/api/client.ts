export type ApiHealth = {
  status: "ok";
  service: "lockin-api";
};

export type ApiErrorPayload = {
  error?: {
    code?: string;
    message?: string;
    fields?: Record<string, string[] | string> | null;
    request_id?: string | null;
  };
};

const configuredBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "/api/v1";

if (!/^\/(?!\/)/.test(configuredBaseUrl)) {
  throw new Error("VITE_API_BASE_URL must be a same-origin absolute path.");
}

const apiBaseUrl = configuredBaseUrl.replace(/\/$/, "");
let csrfToken: string | null = null;

export function apiPath(path: string): string {
  if (!/^\/(?!\/)/.test(path)) throw new Error("API paths must be same-origin absolute API paths.");
  return `${apiBaseUrl}${path}`;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Record<string, string[] | string> | null;
  readonly requestId: string | null;

  constructor(status: number, payload: ApiErrorPayload) {
    super(payload.error?.message ?? "The request could not be completed.");
    this.name = "ApiError";
    this.status = status;
    this.code = payload.error?.code ?? "request_failed";
    this.fields = payload.error?.fields ?? null;
    this.requestId = payload.error?.request_id ?? null;
  }
}

function isUnsafe(method: string): boolean {
  return !["GET", "HEAD", "OPTIONS", "TRACE"].includes(method.toUpperCase());
}

export async function refreshCsrfToken(): Promise<string> {
  const response = await fetch(`${apiBaseUrl}/auth/csrf`, {
    method: "GET",
    headers: { Accept: "application/json" },
    credentials: "same-origin",
    cache: "no-store"
  });
  if (!response.ok) {
    throw new Error("Lock-in could not establish a secure browser session.");
  }
  const payload = (await response.json()) as { csrf_token?: string };
  if (!payload.csrf_token) {
    throw new Error("The CSRF response did not match the expected contract.");
  }
  csrfToken = payload.csrf_token;
  return csrfToken;
}

export async function apiRequest<T>(
  path: string,
  options: Omit<RequestInit, "body"> & { body?: unknown } = {}
): Promise<T> {
  const { body: requestBody, ...requestOptions } = options;
  const method = requestOptions.method ?? "GET";
  const headers = new Headers(requestOptions.headers);
  headers.set("Accept", "application/json");
  let body: BodyInit | undefined;

  if (requestBody instanceof FormData) {
    body = requestBody;
  } else if (requestBody !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(requestBody);
  }
  if (isUnsafe(method)) {
    headers.set("X-CSRFToken", csrfToken ?? (await refreshCsrfToken()));
  }

  const request: RequestInit = {
    ...requestOptions,
    method,
    headers,
    credentials: "same-origin",
    cache: "no-store"
  };
  if (body !== undefined) request.body = body;

  const response = await fetch(apiPath(path), request);
  if (!response.ok) {
    let payload: ApiErrorPayload = {};
    if ((response.headers.get("content-type") ?? "").includes("application/json")) {
      payload = (await response.json()) as ApiErrorPayload;
    }
    throw new ApiError(response.status, payload);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export async function getApiHealth(signal?: AbortSignal): Promise<ApiHealth> {
  const payload = await apiRequest<Partial<ApiHealth>>(
    "/health/live",
    signal ? { signal } : {}
  );
  if (payload.status !== "ok" || payload.service !== "lockin-api") {
    throw new Error("Health response did not match the expected contract.");
  }
  return payload as ApiHealth;
}
