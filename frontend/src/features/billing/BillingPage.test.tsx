import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../i18n/I18nProvider";
import { BillingPage } from "./BillingPage";

const api = vi.hoisted(() => ({
  billingApi: {
    currentSubscription: vi.fn(),
    entitlements: vi.fn(),
    catalog: vi.fn(),
    payments: vi.fn(),
    invoices: vi.fn(),
    refunds: vi.fn(),
    cancelCurrent: vi.fn()
  }
}));

vi.mock("./api", () => api);

const subscription = {
  id: "sub-1",
  product_code: "lockin",
  plan_code: "lockin_trial",
  plan_title: "Lock-in trial",
  status: "trialing" as const,
  trial_started_at: "2026-07-01T00:00:00Z",
  trial_ends_at: "2026-07-31T00:00:00Z",
  current_period_started_at: "2026-07-01T00:00:00Z",
  current_period_ends_at: "2026-07-31T00:00:00Z",
  grace_ends_at: null,
  cancel_at_period_end: false,
  cancellation_requested_at: null,
  ended_at: null,
  status_reason: "trial_started",
  revision: 1,
  transitions: []
};

const emptyPage = { next: null, previous: null, results: [] };

function renderPage() {
  return render(
    <MemoryRouter>
      <I18nProvider>
        <BillingPage />
      </I18nProvider>
    </MemoryRouter>
  );
}

describe("billing workspace", () => {
  beforeEach(() => {
    localStorage.setItem("lockin.locale", "en");
    vi.clearAllMocks();
    api.billingApi.currentSubscription.mockResolvedValue({ subscription });
    api.billingApi.entitlements.mockResolvedValue({
      results: [
        {
          id: "grant-1",
          code: "focus.workspace",
          title: "Focus workspace",
          description: "Professional study workspace.",
          source_type: "subscription",
          starts_at: "2026-07-01T00:00:00Z",
          ends_at: "2026-07-31T00:00:00Z",
          quantity_limit: null,
          configuration: {}
        }
      ]
    });
    api.billingApi.catalog.mockResolvedValue({ results: [], checkout_available: false });
    api.billingApi.payments.mockResolvedValue(emptyPage);
    api.billingApi.invoices.mockResolvedValue(emptyPage);
    api.billingApi.refunds.mockResolvedValue(emptyPage);
    api.billingApi.cancelCurrent.mockResolvedValue({
      ...subscription,
      cancel_at_period_end: true,
      cancellation_requested_at: "2026-07-18T00:00:00Z",
      revision: 2
    });
  });

  it("explains plan, entitlements, honest offer state, and empty billing history", async () => {
    renderPage();
    expect(screen.getByLabelText("Loading your plan and access")).toBeInTheDocument();

    expect(await screen.findByRole("heading", { name: "Plan and access" })).toBeInTheDocument();
    expect(screen.getByText("Lock-in trial")).toBeInTheDocument();
    expect(screen.getByText("Focus workspace")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "No paid offer is published yet" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "No invoices yet" })).toBeInTheDocument();
    expect(screen.getByText(/Payments recorded/)).toHaveTextContent("0");
  });

  it("uses an inline confirmation before scheduling cancellation", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Manage cancellation" }));
    expect(screen.getByRole("heading", { name: "Schedule cancellation?" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Schedule cancellation" }));

    await waitFor(() => expect(api.billingApi.cancelCurrent).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/Cancellation is scheduled for/)).toBeInTheDocument();
  });

  it("keeps the plan unchanged and shows an error when cancellation fails", async () => {
    api.billingApi.cancelCurrent.mockRejectedValueOnce(new Error("offline"));
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Manage cancellation" }));
    fireEvent.click(screen.getByRole("button", { name: "Schedule cancellation" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Cancellation could not be scheduled"
    );
    expect(screen.getByRole("heading", { name: "Schedule cancellation?" })).toBeInTheDocument();
  });

  it("offers retry when the billing projections cannot load", async () => {
    api.billingApi.currentSubscription.mockRejectedValueOnce(new Error("offline"));
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your billing workspace could not be loaded"
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(api.billingApi.currentSubscription).toHaveBeenCalledTimes(2));
  });

  it("renders published multi-currency offers and immutable invoice history", async () => {
    api.billingApi.currentSubscription.mockResolvedValueOnce({
      subscription: {
        ...subscription,
        status: "active",
        trial_ends_at: null,
        current_period_ends_at: "2026-08-31T00:00:00Z"
      }
    });
    api.billingApi.catalog.mockResolvedValueOnce({
      checkout_available: false,
      results: [
        {
          id: "product-1",
          code: "lockin",
          title: "Lock-in",
          description: "Study operating system",
          plans: [
            {
              id: "plan-1",
              code: "study",
              current_version: {
                id: "version-1",
                version: 1,
                title: "Lock-in Study",
                description: "A published learning plan.",
                audience: "individual",
                trial_days: 0,
                grace_days: 3,
                prices: [
                  {
                    id: "price-1",
                    code: "bhd_monthly",
                    amount_minor: 1_234,
                    currency: "BHD",
                    currency_exponent: 3,
                    region_code: "",
                    interval: "month",
                    interval_count: 1,
                    tax_behavior: "unspecified",
                    valid_until: null
                  }
                ]
              }
            }
          ]
        }
      ]
    });
    api.billingApi.invoices.mockResolvedValueOnce({
      ...emptyPage,
      results: [
        {
          id: "invoice-1",
          number: "LI-2026-000001",
          subscription_id: subscription.id,
          payment_id: "payment-1",
          status: "paid",
          currency: "BHD",
          currency_exponent: 3,
          subtotal_minor: 1_234,
          discount_minor: 0,
          tax_minor: 0,
          total_minor: 1_234,
          amount_paid_minor: 1_234,
          amount_refunded_minor: 0,
          period_started_at: "2026-07-01T00:00:00Z",
          period_ends_at: "2026-08-01T00:00:00Z",
          issued_at: "2026-07-01T00:00:00Z",
          paid_at: "2026-07-01T00:00:00Z",
          lines: []
        }
      ]
    });

    renderPage();
    expect(await screen.findByRole("heading", { name: "Lock-in Study" })).toBeInTheDocument();
    expect(screen.getAllByText(/BHD\s*1\.234/)).toHaveLength(2);
    expect(screen.getByText("LI-2026-000001")).toBeInTheDocument();
    expect(screen.getByText("Checkout is not enabled in this deployment.")).toBeInTheDocument();
  });

  it("explains accounts with no plan or active entitlements", async () => {
    api.billingApi.currentSubscription.mockResolvedValueOnce({ subscription: null });
    api.billingApi.entitlements.mockResolvedValueOnce({ results: [] });
    renderPage();

    expect(await screen.findByRole("heading", { name: "No plan is active" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "No active entitlements" })).toBeInTheDocument();
  });
});
