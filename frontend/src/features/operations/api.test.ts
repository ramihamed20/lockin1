import { beforeEach, describe, expect, it, vi } from "vitest";

import { operationsApi } from "./api";

const client = vi.hoisted(() => ({ apiRequest: vi.fn(), apiDownload: vi.fn() }));
vi.mock("../../api/client", () => client);

describe("operations API contracts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    client.apiRequest.mockResolvedValue({});
    client.apiDownload.mockResolvedValue({ blob: new Blob(), filename: "report.csv" });
  });

  it("uses versioned same-origin read contracts with optional cancellation", async () => {
    const controller = new AbortController();
    await operationsApi.session();
    await operationsApi.session(controller.signal);
    await operationsApi.overview();
    await operationsApi.overview(controller.signal);
    await operationsApi.content();
    await operationsApi.content(controller.signal);
    await operationsApi.support();
    await operationsApi.support(controller.signal);
    await operationsApi.health();
    await operationsApi.health(controller.signal);
    await operationsApi.users();
    await operationsApi.users("rami", controller.signal);
    await operationsApi.audit();
    await operationsApi.audit("reporting", controller.signal);
    await operationsApi.configuration();
    await operationsApi.configuration(controller.signal);
    await operationsApi.reports();
    await operationsApi.reports(controller.signal);

    expect(client.apiRequest).toHaveBeenCalledWith("/operations/session", {});
    expect(client.apiRequest).toHaveBeenCalledWith("/operations/users?q=rami", { signal: controller.signal });
    expect(client.apiRequest).toHaveBeenCalledWith("/operations/audit?domain=reporting", { signal: controller.signal });
  });

  it("sends version, reason, preview, confirmation, and idempotency data", async () => {
    const entry = {
      key: "analytics.default_window_days", name: "Window", description: "Days", value_type: "integer" as const,
      value: 14, version: 3, minimum: 1, maximum: 90, updated_at: null
    };
    await operationsApi.updateConfiguration(entry, 21, "Use three weeks");
    await operationsApi.previewReport("analytics_daily");
    const report = {
      id: "report-1", report_code: "analytics_daily", status: "previewed" as const, filters: {},
      estimated_rows: 1, truncated: false, expires_at: "2026-07-18T00:00:00Z", confirmation_token: "token"
    };
    await operationsApi.executeReport(report);
    await operationsApi.previewUserStatus("user-1", "suspended", "Safety review");
    const action = {
      id: "run-1", action_code: "users.set_status" as const, reason: "Safety review", status: "previewed" as const,
      preview: { target_count: 1, changes: [] }, confirmation_token: "action-token"
    };
    await operationsApi.executeAction(action);
    await operationsApi.updateRoles("user-1", ["support"], "Support coverage");

    expect(client.apiRequest).toHaveBeenCalledWith("/operations/configuration/analytics.default_window_days", expect.objectContaining({ body: { value: 21, expected_version: 3, reason: "Use three weeks" } }));
    const calls = client.apiRequest.mock.calls as unknown as Array<[string, { body?: { idempotency_key?: unknown } }]>;
    const actionRequest = calls.find(([path]) => path === "/operations/actions/previews");
    expect(typeof actionRequest?.[1].body?.idempotency_key).toBe("string");
    expect(client.apiDownload).toHaveBeenCalledWith("/operations/reports/report-1/execute", expect.objectContaining({ body: { confirmation_token: "token" } }));
  });
});
