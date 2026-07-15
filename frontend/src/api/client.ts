export type ApiHealth = {
  status: "ok";
  service: "lockin-api";
};

const configuredBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "/api/v1";

if (!/^\/(?!\/)/.test(configuredBaseUrl)) {
  throw new Error("VITE_API_BASE_URL must be a same-origin absolute path.");
}

const apiBaseUrl = configuredBaseUrl.replace(/\/$/, "");

export async function getApiHealth(signal?: AbortSignal): Promise<ApiHealth> {
  const request: RequestInit = {
    method: "GET",
    headers: { Accept: "application/json" },
    credentials: "same-origin"
  };
  if (signal) {
    request.signal = signal;
  }
  const response = await fetch(`${apiBaseUrl}/health/live`, request);
  if (!response.ok) {
    throw new Error(`Health request failed with status ${response.status}.`);
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new Error("Health response was not JSON.");
  }
  const payload = (await response.json()) as Partial<ApiHealth>;
  if (payload.status !== "ok" || payload.service !== "lockin-api") {
    throw new Error("Health response did not match the expected contract.");
  }
  return payload as ApiHealth;
}
