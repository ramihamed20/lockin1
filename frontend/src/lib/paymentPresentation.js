export function paymentDisplayStatus(payment) {
  // Final money states remain authoritative, including refunds after approval.
  if (["succeeded", "failed", "cancelled", "partially_refunded", "refunded"].includes(payment.status)) return payment.status;
  if (["pending", "approved", "rejected", "cancelled"].includes(payment.manual_submission?.status)) return payment.manual_submission.status;
  return ["initiated", "pending"].includes(payment.status) ? payment.status : "unknown";
}

export function formatPaymentAmount(amountMinor, currency, exponent, locale) {
  if (!Number.isFinite(Number(amountMinor)) || amountMinor === null || !Number.isInteger(exponent) || exponent < 0 || exponent > 6 || !/^[A-Z]{3}$/i.test(currency || "")) return "—";
  try {
    return new Intl.NumberFormat(locale === "ar" ? "ar-LY-u-nu-latn" : "en-LY", {
      style: "currency", currency, minimumFractionDigits: 0, maximumFractionDigits: exponent
    }).format(Number(amountMinor) / 10 ** exponent);
  } catch { return "—"; }
}
