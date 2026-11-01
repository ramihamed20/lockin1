import { useState } from "react";
import { useI18n } from "../I18nProvider.jsx";
import { directorySearchMessages, filterDirectory } from "../../lib/directorySearch.js";
import "./searchable-directory.css";

export function SearchableDirectory({ items, getTitle, children }) {
  const { locale } = useI18n();
  const copy = directorySearchMessages[locale] || directorySearchMessages.en;
  const [query, setQuery] = useState("");
  // Small directories need no additional controls.
  const searchable = items.length > 5 || Boolean(query);
  const visible = filterDirectory(items, query, getTitle);
  return <div className="searchable-directory">
    {searchable && <div className="directory-search-controls">
      <label className="field"><span>{copy.label}</span><input type="search" value={query} onChange={event => setQuery(event.target.value)} autoComplete="off" dir="auto" /></label>
      {query && <button type="button" className="btn btn-soft" onClick={() => setQuery("")}>{copy.clear}</button>}
    </div>}
    {visible.length ? children(visible) : <p role="status">{copy.empty}</p>}
  </div>;
}
