import { ApiError, request } from "./client.js";
import { generateIdempotencyKey } from "./pagination.js";

function objectPayload(payload, message) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new ApiError(500, payload, message, "invalid_response");
  }
  return /** @type {Record<string, unknown>} */ (payload);
}

function resultsPayload(payload, message) {
  if (Array.isArray(payload)) return payload;
  const source = objectPayload(payload, message);
  if (!Array.isArray(source.results)) {
    throw new ApiError(500, payload, message, "invalid_response");
  }
  return source.results;
}

function currentSubscriptionPayload(payload) {
  const source = objectPayload(payload, "The current-subscription response was incomplete.");
  if (source.subscription !== null && (typeof source.subscription !== "object" || Array.isArray(source.subscription))) {
    throw new ApiError(500, payload, "The current-subscription response was incomplete.", "invalid_response");
  }
  return source.subscription;
}

function catalogPayload(payload) {
  const source = objectPayload(payload, "The plan catalog response was incomplete.");
  if (!Array.isArray(source.results) || typeof source.checkout_available !== "boolean") {
    throw new ApiError(500, payload, "The plan catalog response was incomplete.", "invalid_response");
  }
  return {
    results: source.results,
    checkoutAvailable: source.checkout_available,
    manualPaymentAvailable: source.manual_payment_available === true
  };
}

function checkoutPayload(payload) {
  const source = objectPayload(payload, "The checkout response was incomplete.");
  const payment = objectPayload(source.payment, "The checkout payment response was incomplete.");
  const checkout = objectPayload(source.checkout, "The checkout provider response was incomplete.");
  return { payment, checkout };
}

export const billingApi = {
  currentSubscription() {
    return request("/subscriptions/current").then(currentSubscriptionPayload);
  },

  currentEntitlements() {
    return request("/entitlements/me").then((payload) => resultsPayload(payload, "The entitlement response was incomplete."));
  },

  async accessSnapshot() {
    const [subscription, entitlements] = await Promise.all([
      this.currentSubscription(),
      this.currentEntitlements()
    ]);
    return { subscription, entitlements };
  },

  async details() {
    const [catalog, payments, invoices, refunds] = await Promise.all([
      request("/catalog/products").then(catalogPayload),
      request("/payments").then((payload) => resultsPayload(payload, "The payment history response was incomplete.")),
      request("/invoices").then((payload) => resultsPayload(payload, "The invoice history response was incomplete.")),
      request("/refunds").then((payload) => resultsPayload(payload, "The refund history response was incomplete."))
    ]);
    return { catalog, payments, invoices, refunds };
  },

  async summary() {
    const [subscription, entitlements, catalog, payments, invoices, refunds] = await Promise.all([
      request("/subscriptions/current").then(currentSubscriptionPayload),
      this.currentEntitlements(),
      request("/catalog/products").then(catalogPayload),
      request("/payments").then((payload) => resultsPayload(payload, "The payment history response was incomplete.")),
      request("/invoices").then((payload) => resultsPayload(payload, "The invoice history response was incomplete.")),
      request("/refunds").then((payload) => resultsPayload(payload, "The refund history response was incomplete."))
    ]);
    return { subscription, entitlements, catalog, payments, invoices, refunds };
  },

  async cancelCurrent() {
    return objectPayload(
      await request("/subscriptions/current/cancel", { method: "POST", body: {} }),
      "The cancellation response was incomplete."
    );
  },

  async startCheckout(priceId) {
    return checkoutPayload(await request("/payments/intents", {
      method: "POST",
      body: { price_id: priceId },
      idempotencyKey: generateIdempotencyKey()
    }));
  },

  async submitLibyana(planId, rechargeCode) {
    const source = objectPayload(
      await request("/payments/manual-libyana", {
        method: "POST",
        body: { plan_id: planId, recharge_code: rechargeCode },
        idempotencyKey: generateIdempotencyKey()
      }),
      "The Libyana payment response was incomplete."
    );
    return {
      payment: objectPayload(source.payment, "The payment record was incomplete."),
      submission: objectPayload(source.submission, "The payment submission was incomplete."),
      subscription: objectPayload(source.subscription, "The subscription response was incomplete.")
    };
  }
};

export function safeCheckoutUrl(value) {
  if (typeof value !== "string" || !value) return "";
  try {
    const url = new URL(value, window.location.origin);
    if (url.protocol !== "https:" && url.origin !== window.location.origin) return "";
    return url.href;
  } catch {
    return "";
  }
}
