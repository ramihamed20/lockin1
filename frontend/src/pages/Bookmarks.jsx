import { useState } from "react";
import { Link } from "react-router-dom";
import { progressApi } from "../api/progress.js";
import { Icon } from "../lib/icons.jsx";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { EmptyState, ErrorPanel, ListRow, LoadingPanel, Page } from "../components/ui/index.jsx";
import { ConfirmDialog } from "../components/shared/ConfirmDialog.jsx";
import { PaginationControls } from "../components/learning/PaginationControls.jsx";

export default function Bookmarks() {
  const [page, setPage] = useState(1);
  const bookmarks = useAsyncData(() => progressApi.listBookmarks({ page }), [page]);
  const [confirmItem, setConfirmItem] = useState(null);
  const [mutationError, setMutationError] = useState(null);
  const [removing, setRemoving] = useState(false);

  async function removeBookmark(item) {
    const learningObjectId = item?.learning_object?.id;
    if (!learningObjectId) return;
    setRemoving(true);
    setMutationError(null);
    try {
      await progressApi.removeBookmark(learningObjectId);
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
    <Page title="Bookmarks" subtitle="Published learning materials you saved for later review.">
      {mutationError && <ErrorPanel message={mutationError.message} onRetry={() => confirmItem && void removeBookmark(confirmItem)} />}
      <section className="list-panel">
        {bookmarks.data.results.length ? bookmarks.data.results.map((item) => {
          const learningObject = item.learning_object;
          const version = learningObject?.version;
          const title = version?.title || "Published learning material";
          const meta = version?.summary || `${version?.content_type || "Learning"} material saved for later.`;
          return (
            <ListRow
              key={item.id}
              title={title}
              meta={meta}
              icon="bookmark"
              action={<div className="focus-timer-actions"><Link className="btn btn-soft compact" to={`/materials/objects/${learningObject.id}`}>Open</Link><button className="btn btn-danger compact" type="button" onClick={() => setConfirmItem(item)} aria-label={`Remove ${title}`}><Icon name="x" size={17} /> Remove</button></div>}
            />
          );
        }) : <EmptyState title="Nothing saved yet" text="Save a published learning material to keep it in this list." />}
      </section>
      <PaginationControls page={page} pageData={bookmarks.data} onPageChange={setPage} label="Bookmark pages" />
      <ConfirmDialog
        open={Boolean(confirmItem)}
        title="Remove bookmark?"
        message={`Remove "${confirmItem?.learning_object?.version?.title || "this material"}" from your saved list?`}
        confirmLabel={removing ? "Removing…" : "Remove"}
        onConfirm={() => void removeBookmark(confirmItem)}
        onCancel={() => !removing && setConfirmItem(null)}
      />
    </Page>
  );
}

