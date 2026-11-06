import "./bookmarks.css";
import { useState } from "react";
import { Link } from "react-router-dom";
import { progressApi } from "../api/progress.js";
import { Icon } from "../lib/icons.jsx";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { EmptyState, ErrorPanel, LoadingPanel, Page } from "../components/ui/index.jsx";
import { ConfirmDialog } from "../components/shared/ConfirmDialog.jsx";
import { PaginationControls } from "../components/learning/PaginationControls.jsx";
import { SubjectBanner } from "../components/learning/SubjectBanner.jsx";
import { sheetCoverTone } from "../lib/sheetPresentation.js";
import { useI18n } from "../components/I18nProvider.jsx";

export default function Bookmarks() {
  const { t } = useI18n();
  const [page, setPage] = useState(1);
  const bookmarks = useAsyncData(() => progressApi.listBookmarks({ page }), [page], { cacheKey: `bookmarks:${page}` });
  const [confirmItem, setConfirmItem] = useState(null);
  const [mutationError, setMutationError] = useState(null);
  const [removing, setRemoving] = useState(false);

  async function removeBookmark(item) {
    const learningObjectId = item?.learning_object?.id;
    const materialSlug = item?.catalog_material_slug;
    const sheetSlug = item?.catalog_sheet_slug;
    if (!learningObjectId && (!materialSlug || !sheetSlug)) return;
    setRemoving(true);
    setMutationError(null);
    try {
      if (learningObjectId) await progressApi.removeBookmark(learningObjectId);
      else await progressApi.removeCatalogBookmark(materialSlug, sheetSlug);
      setConfirmItem(null);
      bookmarks.reload();
    } catch (requestError) {
      setMutationError(requestError);
    } finally {
      setRemoving(false);
    }
  }

  if (bookmarks.loading) return <Page width="reading" title="Bookmarks" showHeading><LoadingPanel variant="list" /></Page>;
  if (bookmarks.error) return <Page width="reading" title="Bookmarks" showHeading><ErrorPanel message={bookmarks.errorDetails || bookmarks.error} onRetry={bookmarks.reload} /></Page>;

  return (
    <Page width="reading" title="Bookmarks" showHeading>
      {mutationError && <ErrorPanel message={mutationError.message} onRetry={() => confirmItem && void removeBookmark(confirmItem)} />}
      {/* An empty list is a state, not an empty card. */}
      {!bookmarks.data.results.length && <EmptyState icon="study" title={t("bookmarks.emptyTitle")} text={t("bookmarks.emptyText")} action={{ label: t("dashboard.browseMaterials"), to: "/materials" }} />}
      {bookmarks.data.results.length > 0 && <ul className="bookmark-cards">
        {bookmarks.data.results.map((item) => {
          const learningObject = item.learning_object;
          const version = learningObject?.version;
          const catalogBookmark = Boolean(item.catalog_sheet_slug);
          const title = catalogBookmark ? item.catalog_sheet_title : version?.title || t("bookmarks.fallbackTitle");
          const savedPage = Number(item.position?.page);
          const meta = catalogBookmark
            ? `${item.catalog_material_title}${savedPage > 0 ? ` · ${t("common.pageNumber", { page: savedPage })}` : ""}`
            : version?.summary || t("bookmarks.fallbackMeta", { type: version?.content_type || t("bookmarks.fallbackType") });
          const openPath = catalogBookmark
            ? `/materials/catalog/${item.catalog_material_slug}/sheets/${item.catalog_sheet_slug}/workspace${savedPage > 0 ? `?page=${savedPage}` : ""}`
            : null;
          const material = { slug: item.catalog_material_slug, title: item.catalog_material_title };
          const contents = <>
            <span className="bookmark-card__cover" data-tone={sheetCoverTone(material)} aria-hidden="true">
              {catalogBookmark ? <SubjectBanner material={material} variant="cover" /> : <Icon name="bookmark" size={23} />}
            </span>
            <span className="bookmark-card__copy">
              <strong dir="auto">{title}</strong>
              <small dir="auto">{meta}</small>
            </span>
            {openPath && <Icon className="bookmark-card__arrow" name="chevron-right" size={17} aria-hidden="true" />}
          </>;
          return (
            <li className="bookmark-card" key={item.id}>
              {openPath
                ? <Link className="bookmark-card__main" to={openPath}>{contents}</Link>
                : <div className="bookmark-card__main">{contents}</div>}
              <button className="bookmark-card__remove" type="button" onClick={() => setConfirmItem(item)} aria-label={t("bookmarks.removeNamed", { name: title })} title={t("common.remove")}>
                <Icon name="x" size={17} aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>}
      <PaginationControls page={page} pageData={bookmarks.data} onPageChange={setPage} label={t("bookmarks.pages")} />
      <ConfirmDialog
        open={Boolean(confirmItem)}
        title={t("bookmarks.confirmTitle")}
        message={t("bookmarks.confirmMessage", { name: confirmItem?.catalog_sheet_title || confirmItem?.learning_object?.version?.title || t("bookmarks.thisMaterial") })}
        confirmLabel={removing ? t("bookmarks.removing") : t("common.remove")}
        onConfirm={() => void removeBookmark(confirmItem)}
        onCancel={() => !removing && setConfirmItem(null)}
      />
    </Page>
  );
}
