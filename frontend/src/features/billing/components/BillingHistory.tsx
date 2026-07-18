import { EmptyState } from "../../../components/Feedback";
import { useI18n } from "../../../i18n/I18nProvider";
import { formatDate, formatMoney } from "../format";
import type { Invoice, Payment, Refund } from "../types";

type Props = { invoices: Invoice[]; payments: Payment[]; refunds: Refund[] };

export function BillingHistory({ invoices, payments, refunds }: Props) {
  const { locale, t } = useI18n();
  return (
    <section className="billing-section billing-history" aria-labelledby="history-heading">
      <header>
        <div>
          <p className="billing-kicker">{t("historyEyebrow")}</p>
          <h2 id="history-heading">{t("billingHistory")}</h2>
        </div>
        <p>{t("billingHistoryCopy")}</p>
      </header>
      {invoices.length ? (
        <div className="billing-table-wrap">
          <table className="billing-table">
            <thead>
              <tr>
                <th scope="col">{t("invoiceNumber")}</th>
                <th scope="col">{t("issued")}</th>
                <th scope="col">{t("billingStatus")}</th>
                <th scope="col">{t("amount")}</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((invoice) => (
                <tr key={invoice.id}>
                  <th scope="row" data-label={t("invoiceNumber")}>{invoice.number}</th>
                  <td data-label={t("issued")}>{formatDate(invoice.issued_at, locale)}</td>
                  <td data-label={t("billingStatus")}>{invoice.status.replaceAll("_", " ")}</td>
                  <td data-label={t("amount")}>
                    {formatMoney(
                      invoice.total_minor,
                      invoice.currency,
                      invoice.currency_exponent,
                      locale
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState title={t("noInvoices")}>{t("noInvoicesCopy")}</EmptyState>
      )}
      <div className="transaction-summary" aria-label={t("transactionSummary") }>
        <span>{t("paymentsRecorded")} <strong>{payments.length.toLocaleString(locale)}</strong></span>
        <span>{t("refundsRecorded")} <strong>{refunds.length.toLocaleString(locale)}</strong></span>
      </div>
    </section>
  );
}
