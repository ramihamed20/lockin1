/** Stable counterparts of content.page_question_bank; shared by offline runs and prompts. */
export const MAX_CUSTOM_PAGES = 10;
export const MAX_CUSTOM_QUESTIONS = 30;
export const QUESTIONS_PER_PAGE = 15;

/** Most pages one custom test may cover on a sheet with this many study pages. */
export const maxCustomPages = (eligiblePages) => Math.min(MAX_CUSTOM_PAGES, Math.max(0, Number(eligiblePages) || 0));

/**
 * Most questions a custom test of `pages` pages can ask: the overall cap, and
 * what the shortest group (usually the last) can supply at 15 per page.
 */
export function maxCustomQuestions(eligiblePages, pages) {
  if (!Number.isInteger(pages) || pages < 1 || !eligiblePages) return MAX_CUSTOM_QUESTIONS;
  const remainder = eligiblePages % pages;
  const shortest = remainder === 0 ? Math.min(pages, eligiblePages) : Math.min(pages, remainder);
  return Math.min(MAX_CUSTOM_QUESTIONS, shortest * QUESTIONS_PER_PAGE);
}

export function customPageRanges(start, end, size) {
  if (!Number.isInteger(size) || size < 1 || size > Math.min(MAX_CUSTOM_PAGES, end - start + 1)) throw new Error("Choose a valid page count.");
  const ranges = [];
  for (let page = start; page <= end; page += size) ranges.push({ part: ranges.length + 1, start_page: page, end_page: Math.min(end, page + size - 1) });
  return ranges;
}

export function selectPageQuestions(payload, start, end, count) {
  let pages = payload.pages.filter((item) => item.page >= start && item.page <= end);
  // Banks written with more than QUESTIONS_PER_PAGE per page use only the first of each.
  if (!Number.isInteger(count) || count < 1 || !pages.length || pages.reduce((total, page) => total + Math.min(QUESTIONS_PER_PAGE, page.questions.length), 0) < count) throw new Error("There are not enough questions for these pages.");
  if (count < pages.length) pages = Array.from({ length: count }, (_, index) => pages[Math.floor(index * pages.length / count)]);
  const selected = [];
  for (let position = 0; position < Math.min(QUESTIONS_PER_PAGE, Math.max(...pages.map((page) => page.questions.length))); position += 1) {
    for (const page of pages) {
      if (position < page.questions.length) {
        selected.push({ ...page.questions[position], source_key: `page:${page.page}:question:${position + 1}` });
        if (selected.length === count) return selected;
      }
    }
  }
  return selected;
}

export function bankPageNumbers(ranges) {
  return ranges.flatMap((range) => Array.from({ length: range.end_page - range.start_page + 1 }, (_, index) => range.start_page + index));
}
