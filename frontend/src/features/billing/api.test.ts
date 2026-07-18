import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock("../../api/client", () => ({ apiRequest }));

import { billingApi } from "./api";

describe("billing API contracts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiRequest.mockResolvedValue({});
  });

  it("reads every server-owned billing projection with abort support", async () => {
    const controller = new AbortController();
    await billingApi.currentSubscription(controller.signal);
    await billingApi.entitlements();
    await billingApi.catalog(controller.signal);
    await billingApi.payments();
    await billingApi.invoices(controller.signal);
    await billingApi.refunds();

    expect(apiRequest).toHaveBeenNthCalledWith(1, "/subscriptions/current", {
      signal: controller.signal
    });
    expect(apiRequest).toHaveBeenCalledWith("/entitlements/me", {});
    expect(apiRequest).toHaveBeenCalledWith("/catalog/products", {
      signal: controller.signal
    });
    expect(apiRequest).toHaveBeenCalledWith("/payments", {});
    expect(apiRequest).toHaveBeenCalledWith("/invoices", {
      signal: controller.signal
    });
    expect(apiRequest).toHaveBeenCalledWith("/refunds", {});
  });

  it("schedules cancellation without sending client-owned subscription state", async () => {
    await billingApi.cancelCurrent();
    expect(apiRequest).toHaveBeenCalledWith("/subscriptions/current/cancel", {
      method: "POST"
    });
  });
});
