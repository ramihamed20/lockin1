/** Stable counterparts of content.page_question_bank; shared by offline runs and prompts. */
export function customPageRanges(start, end, size) {
  if (!Number.isInteger(size) || size < 1 || size > end - start + 1) throw new Error("Choose a valid page count.");
  const ranges = [];
  for (let page = start; page <= end; page += size) ranges.push({ part: ranges.length + 1, start_page: page, end_page: Math.min(end, page + size - 1) });
  return ranges;
}

export function selectPageQuestions(payload, start, end, count) {
  let pages = payload.pages.filter((item) => item.page >= start && item.page <= end);
  if (!Number.isInteger(count) || count < 1 || !pages.length || pages.reduce((total, page) => total + page.questions.length, 0) < count) throw new Error("There are not enough questions for these pages.");
  if (count < pages.length) pages = Array.from({ length: count }, (_, index) => pages[Math.floor(index * pages.length / count)]);
  const selected = [];
  for (let position = 0; position < Math.max(...pages.map((page) => page.questions.length)); position += 1) {
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
