import { Link, Navigate, useParams } from "react-router-dom";
import { request } from "../api/client.js";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { useI18n } from "../components/I18nProvider.jsx";
import { ErrorPanel, LoadingPanel, Page } from "../components/ui/index.jsx";

export default function ReviewSource() {
  const { itemId } = useParams();
  const { t } = useI18n();
  const source = useAsyncData(() => request(`/review-bank/items/${encodeURIComponent(itemId)}/source`), [itemId]);
  if (source.loading) return <LoadingPanel variant="sheet" />;
  const item = source.data;
  if (source.error || !item?.material_slug || !item?.sheet_slug || !Number.isInteger(item.page) || item.page < 1) return <Page title={t("review.sourcePage")}><ErrorPanel message={source.error || t("review.sourceUnavailable")} onRetry={source.reload} /><Link to="/review">{t("review.backToCenter")}</Link></Page>;
  const path = `/materials/catalog/${encodeURIComponent(item.material_slug)}/sheets/${encodeURIComponent(item.sheet_slug)}/workspace?sourcePage=${item.page}&sourceVersion=${encodeURIComponent(item.document_version_id)}`;
  return <Navigate to={path} replace state={{ studyMode: "normal" }} />;
}
