import { useState } from "react";
import { Link } from "react-router-dom";
import { progressApi } from "../api/progress.js";
import { Icon } from "../lib/icons.jsx";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { EmptyState, ErrorPanel, ListRow, LoadingPanel, Page } from "../components/ui/index.jsx";
import { ConfirmDialog } from "../components/shared/ConfirmDialog.jsx";
import { PaginationControls } from "../components/learning/PaginationControls.jsx";
import { useI18n } from "../components/I18nProvider.jsx";

export default function Bookmarks() {
  const { t } = useI18n();
  const [page, setPage] = useState(1);
  const bookmarks = useAsyncData(() => progressApi.listBookmarks({ page }), [page]);
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

  if (bookmarks.loading) return <LoadingPanel />;
  if (bookmarks.error) return <ErrorPanel message={bookmarks.error} onRetry={bookmarks.reload} />;

  return (
    <Page title="Bookmarks" subtitle={t("bookmarks.subtitle")}>
      {mutationError && <ErrorPanel message={mutationError.message} onRetry={() => confirmItem && void removeBookmark(confirmItem)} />}
      <section className="list-panel">
        {bookmarks.data.results.length ? bookmarks.data.results.map((item) => {
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
            : `/materials/objects/${learningObject.id}`;
          return (
            <ListRow
              key={item.id}
              title={title}
              meta={meta}
              icon="bookmark"
              action={<div className="focus-timer-actions"><Link className="btn btn-soft compact" to={openPath}>{t("common.open")}</Link><button className="btn btn-danger compact" type="button" onClick={() => setConfirmItem(item)} aria-label={t("bookmarks.removeNamed", { name: title })}><Icon name="x" size={17} /> {t("common.remove")}</button></div>}
            />
          );
        }) : <EmptyState title={t("bookmarks.emptyTitle")} text={t("bookmarks.emptyText")} />}
      </section>
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
