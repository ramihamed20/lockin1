import { useState } from "react";
import { Link } from "react-router-dom";
import { useI18n } from "../components/I18nProvider.jsx";

/** A session-local reflection, not a diagnosis or a new scheduling signal. */
export function MistakeReflection({ item, outcome, selectedIds, onExplain }) {
  const { t } = useI18n();
  const [reason, setReason] = useState("");
  const labels = ids => (item.options || []).filter(option => ids.map(String).includes(String(option.id))).map(option => option.text).join(" · ");
  return <section className="review-reflection">
    <fieldset>
      <legend>{t("review.reflectTitle")} <small>{t("review.reflectOptional")}</small></legend>
      <div className="review-reflection-options">{["forgot", "confused", "understanding"].map(value => <button type="button" className="btn btn-soft compact" key={value} aria-pressed={reason === value} onClick={() => setReason(current => current === value ? "" : value)}>{t(`review.reflect.${value}`)}</button>)}</div>
    </fieldset>
    {reason && <div className="review-reflection-guidance" role="status">
      <p>{t(`review.reflectHelp.${reason}`)}</p>
      {reason === "confused" && <dl className="review-reflection-comparison"><div><dt>{t("review.yourAnswer")}</dt><dd dir="auto">{labels(selectedIds)}</dd></div><div><dt>{t("review.correctAnswer")}</dt><dd dir="auto">{labels(outcome.review_item?.correct_option_ids || [])}</dd></div></dl>}
      {reason === "understanding" && <div className="review-answer-actions">
        {outcome.review_item?.explanation && <button type="button" className="btn btn-soft compact" onClick={onExplain}>{t("review.readWhy")}</button>}
        {item.original_source?.has_page && <Link className="btn btn-soft compact" to={`/review/source/${encodeURIComponent(item.id)}`} target="_blank" rel="noopener noreferrer">{t("review.sourcePage")}</Link>}
        {!outcome.review_item?.explanation && !item.original_source?.has_page && <Link className="btn btn-soft compact" to="/materials">{t("review.returnToMaterials")}</Link>}
      </div>}
    </div>}
  </section>;
}
