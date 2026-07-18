import { apiRequest } from "../../api/client";
import type {
  Entitlement,
  Invoice,
  Page,
  Payment,
  Product,
  Refund,
  Subscription
} from "./types";

const signalOptions = (signal?: AbortSignal) => (signal ? { signal } : {});

export const billingApi = {
  currentSubscription: (signal?: AbortSignal) =>
    apiRequest<{ subscription: Subscription | null }>(
      "/subscriptions/current",
      signalOptions(signal)
    ),
  entitlements: (signal?: AbortSignal) =>
    apiRequest<{ results: Entitlement[] }>("/entitlements/me", signalOptions(signal)),
  catalog: (signal?: AbortSignal) =>
    apiRequest<{ results: Product[]; checkout_available: boolean }>(
      "/catalog/products",
      signalOptions(signal)
    ),
  payments: (signal?: AbortSignal) =>
    apiRequest<Page<Payment>>("/payments", signalOptions(signal)),
  invoices: (signal?: AbortSignal) =>
    apiRequest<Page<Invoice>>("/invoices", signalOptions(signal)),
  refunds: (signal?: AbortSignal) =>
    apiRequest<Page<Refund>>("/refunds", signalOptions(signal)),
  cancelCurrent: () =>
    apiRequest<Subscription>("/subscriptions/current/cancel", { method: "POST" })
};
