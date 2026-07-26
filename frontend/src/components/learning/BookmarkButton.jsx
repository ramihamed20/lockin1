import { useState } from "react";
import { progressApi } from "../../api/progress.js";
import { Icon } from "../../lib/icons.jsx";

/**
 * Persists bookmark state only after Django confirms the mutation.
 */
export function BookmarkButton({ learningObjectId, isBookmarked, onChanged, compact = false }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  async function toggleBookmark() {
    setPending(true);
    setError(null);
    try {
      if (isBookmarked) await progressApi.removeBookmark(learningObjectId);
      else await progressApi.createBookmark(learningObjectId);
      onChanged?.(!isBookmarked);
    } catch (requestError) {
      setError(requestError);
    } finally {
      setPending(false);
    }
  }

  const label = isBookmarked ? "Remove bookmark" : "Save bookmark";
  return (
    <div>
      <button
        className={`btn ${isBookmarked ? "btn-soft" : "btn-primary"}${compact ? " compact" : ""}`}
        type="button"
        onClick={() => void toggleBookmark()}
        disabled={pending}
        aria-label={label}
      >
        <Icon name="bookmark" size={16} /> {pending ? "Saving…" : isBookmarked ? "Saved" : "Save"}
      </button>
      {error && <p className="inline-error" role="alert">{error.message}</p>}
    </div>
  );
}

