import { useState } from "react";
import { Link } from "react-router-dom";
import { billingApi } from "../../api/billing.js";
import { useAsyncData } from "../../hooks/useAsyncData.js";
import { formatDateTime } from "../../lib/i18n.js";
import { formatPaymentAmount, paymentDisplayStatus } from "../../lib/paymentPresentation.js";
import { Icon } from "../../lib/icons.jsx";
import { useI18n } from "../I18nProvider.jsx";
import { ErrorPanel } from "../ui/index.jsx";

export default function PaymentHistory({ userId }) {
  const { t, locale } = useI18n();
  const [page, setPage] = useState(1);
  // Do not tie history to catalogue, invoice or refund service availability.
  const state = useAsyncData(signal => billingApi.paymentHistory(page, signal), [userId, page]);
  return <div className="ui-group-block settings-v2-block settings-payments" id="settings-payment-history">
    <div className="settings-v2-group-head"><h3 className="ui-group-title">{t("settings.payment.title")}</h3>
      {state.data && <span className="ui-group-title">{t("settings.payment.count", { count: state.data.count })}</span>}
    </div>
    {state.loading && <p className="ui-group-footer" role="status">{t("common.loading")}</p>}
    {state.error && <ErrorPanel message={state.error} onRetry={state.reload} />}
    {state.data && <>
      {!state.data.results.length ? <div className="settings-empty"><Icon name="coins" size={32} /><strong>{t("settings.payment.empty")}</strong><p>{t("settings.payment.emptyHint")}</p></div> : <ul className="ui-group">
        {state.data.results.map(payment => {
          const status = paymentDisplayStatus(payment);
          return <li key={payment.id}><details className="settings-payment">
            <summary className="ui-row">
              <span className="ui-row-icon settings-payment-icon"><Icon name="coins" size={19} /></span>
              <span className="ui-row-body"><strong dir="auto">{payment.price_snapshot?.plan_title || t("settings.payment.plan")}</strong><small>{formatDateTime(payment.created_at, {}, locale)}</small></span>
              <span className="settings-payment-value"><strong dir="auto">{formatPaymentAmount(payment.amount_minor, payment.currency, payment.currency_exponent, locale)}</strong><small className={`settings-payment-status is-${status}`}>{t(`settings.payment.status.${status}`)}</small></span>
              <Icon className="ui-row-chevron settings-v2-disclosure" name="chevron-down" size={16} />
            </summary>
            <div className="settings-payment-detail"><h4 className="sr-only">{t("settings.payment.details")}</h4><dl>
              <div><dt>{t("settings.payment.reference")}</dt><dd dir="ltr">{payment.id}</dd></div>
              <div><dt>{t("settings.payment.method")}</dt><dd>{t(payment.method === "libyana" ? "settings.payment.libyana" : payment.method === "provider" ? "settings.payment.provider" : "settings.payment.unknownMethod")}</dd></div>
              {payment.refunded_amount_minor > 0 && <div><dt>{t("settings.payment.refundedAmount")}</dt><dd>{formatPaymentAmount(payment.refunded_amount_minor, payment.currency, payment.currency_exponent, locale)}</dd></div>}
              {payment.manual_submission?.status === "rejected" && payment.manual_submission.rejection_reason && <div><dt>{t("settings.payment.rejectedReason")}</dt><dd dir="auto">{payment.manual_submission.rejection_reason}</dd></div>}
            </dl></div>
          </details></li>;
        })}
      </ul>}
      {(state.data.hasPrevious || state.data.hasNext) && <div className="settings-payment-paging">
        <button type="button" className="btn btn-soft compact" disabled={!state.data.hasPrevious || state.refreshing} onClick={() => setPage(value => Math.max(1, value - 1))}>{t("settings.payment.previous")}</button>
        <span role="status">{t("settings.payment.page", { page })}</span>
        <button type="button" className="btn btn-soft compact" disabled={!state.data.hasNext || state.refreshing} onClick={() => setPage(value => value + 1)}>{t("settings.payment.next")}</button>
      </div>}
    </>}
    <Link className="settings-text-link" to="/subscription">{t("settings.payment.manage")}<Icon name="chevron-right" size={16} /></Link>
  </div>;
}
