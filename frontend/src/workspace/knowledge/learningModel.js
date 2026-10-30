export function comparisonDraft(concepts, t) {
  if (concepts.length !== 2 || concepts[0].id === concepts[1].id) return null;
  return { title: concepts.map(item => item.title).join(" ↔ ").slice(0, 220), page_start: Math.min(...concepts.map(item => item.page_start)), page_end: Math.max(...concepts.map(item => item.page_end)), concept_ids: concepts.map(item => item.id), text: `${concepts[0].title} ↔ ${concepts[1].title}\n\n${t("connected.similar")}\n\n${t("connected.different")}\n\n${t("connected.example")}\n` };
}
