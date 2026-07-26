import { Icon } from "../../lib/icons.jsx";

/** Uses Django's `previous` and `next` page links, never an inferred total. */
export function PaginationControls({ page, pageData, onPageChange, label }) {
  if (!pageData?.previous && !pageData?.next) return null;
  return (
    <nav className="focus-timer-actions" aria-label={label || "Pagination"}>
      <button className="btn btn-soft" type="button" disabled={!pageData.previous} onClick={() => onPageChange(page - 1)}>
        <Icon name="chevron-left" size={16} /> Previous
      </button>
      <span className="pill">Page {page}</span>
      <button className="btn btn-soft" type="button" disabled={!pageData.next} onClick={() => onPageChange(page + 1)}>
        Next <Icon name="chevron-right" size={16} />
      </button>
    </nav>
  );
}

