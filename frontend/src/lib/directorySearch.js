export function searchText(value) {
  return String(value || "").normalize("NFKD").replace(/\p{M}|ـ/gu, "").toLocaleLowerCase().trim();
}
export function filterDirectory(items, query, getTitle = item => item.title) {
  const words = searchText(query).split(/\s+/).filter(Boolean);
  return words.length ? items.filter(item => words.every(word => searchText(getTitle(item)).includes(word))) : items;
}
export const directorySearchMessages = {
  en: { label: "Search this list", clear: "Clear search", empty: "No matches. Try another name or clear the search." },
  ar: { label: "ابحث في هذه القائمة", clear: "مسح البحث", empty: "لا توجد نتائج. جرّب اسمًا آخر أو امسح البحث." }
};
