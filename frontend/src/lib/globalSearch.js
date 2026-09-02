export function normalizeSearchText(value) {
  return String(value || "").normalize("NFKC").toLocaleLowerCase().trim().replace(/\s+/g, " ");
}

function resultRank(result, query) {
  const title = normalizeSearchText(result.title);
  const subtitle = normalizeSearchText(result.subtitle);
  if (title === query) return 0;
  if (title.startsWith(query)) return 1;
  if (title.includes(query)) return 2;
  if (subtitle.startsWith(query) || subtitle.includes(query)) return 3;
  return 4;
}

export function mergeSearchResults(query, serverResults = []) {
  const normalizedQuery = normalizeSearchText(query);
  const byDestination = new Map();
  serverResults.forEach((result) => {
    const existing = byDestination.get(result.destination);
    if (!existing || resultRank(result, normalizedQuery) < resultRank(existing, normalizedQuery)) {
      byDestination.set(result.destination, result);
    }
  });
  return [...byDestination.values()]
    .sort((left, right) => {
      const rank = resultRank(left, normalizedQuery) - resultRank(right, normalizedQuery);
      if (rank) return rank;
      return String(left.title).localeCompare(String(right.title));
    })
    .slice(0, 12);
}
