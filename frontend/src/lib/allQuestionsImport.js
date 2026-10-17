/** Import transport and preview helpers for the one-document All Questions workflow. */
export const MAX_ALL_QUESTIONS_FILE_BYTES = 16 * 1024 * 1024;
const MULTIPART_THRESHOLD = 1024 * 1024;

export function allQuestionsRequestBody(body) {
  const json = JSON.stringify(body.payload);
  const file = new Blob([json], { type: "application/json" });
  if (file.size > MAX_ALL_QUESTIONS_FILE_BYTES) throw new Error("The question document exceeds the 16 MB import limit.");
  if (file.size < MULTIPART_THRESHOLD) return body;
  const form = new FormData();
  form.append("payload_file", file, "all-questions.json");
  for (const [key, value] of Object.entries(body)) {
    if (key !== "payload" && value != null) form.append(key, typeof value === "object" ? JSON.stringify(value) : String(value));
  }
  return form;
}

export async function readAllQuestionsFile(file) {
  if (!file || !/\.(json|txt)$/i.test(file.name)) throw new Error("Choose a .json or .txt question file.");
  if (file.size > MAX_ALL_QUESTIONS_FILE_BYTES) throw new Error("The question document exceeds the 16 MB import limit.");
  return (await file.text()).replace(/^\uFEFF/, "");
}

export function allQuestionsValidationToken(context, textVersion, normal) {
  if (!context) return "";
  return JSON.stringify([textVersion, context.edition, context.excluded_start_pages, context.excluded_end_pages, normal,
    context.settings_revision, context.difficulties.map((row) => [row.difficulty, row.question_format, row.page_ranges,
      row.questions_per_checkpoint, row.final_exam_questions, row.existing?.revision])]);
}

export function allQuestionsPreviewSections(payload) {
  const sections = [];
  for (const difficulty of ["easy", "medium", "hard"]) {
    const bank = payload?.active_study?.[difficulty];
    if (!bank) continue;
    for (const group of bank.pages || bank.parts || []) {
      sections.push({ id: `${difficulty}-${bank.pages ? "page" : "part"}-${group.page ?? group.part}`, difficulty,
        kind: bank.pages ? "page" : "part", number: group.page ?? group.part, questions: group.questions || [] });
    }
    sections.push({ id: `${difficulty}-final`, difficulty, kind: "final", questions: bank.final_exam?.questions || [] });
  }
  if (payload?.sheet_questions?.questions?.length) sections.push({ id: "normal", difficulty: "normal", kind: "normal", questions: payload.sheet_questions.questions });
  return sections;
}

export function downloadAllQuestionsPrompt(prompt, sheetId) {
  const url = URL.createObjectURL(new Blob([prompt], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `all-questions-${String(sheetId).replace(/[^a-zA-Z0-9_-]/g, "")}.txt`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
