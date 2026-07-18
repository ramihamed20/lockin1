export function formatMoney(
  amountMinor: number,
  currency: string,
  exponent: number,
  locale: string
): string {
  const safeExponent = Math.min(Math.max(exponent, 0), 4);
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: safeExponent,
    maximumFractionDigits: safeExponent
  }).format(amountMinor / 10 ** safeExponent);
}

export function formatDate(value: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(value));
}
