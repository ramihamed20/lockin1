export const companionImportCopy = {
 en: { title: 'Import companion cards (JSON)', intro: 'Short, varied cards for Starmo and Starsea. One subject per file.', one: 'This sheet', several: 'Choose sheets', all: 'Whole subject', prompt: 'Copy prompt', file: 'JSON file', text: 'Paste JSON', preview: 'Preview cards', confirm: 'Confirm import', publish: 'Publish these reviewed cards immediately', saved: 'Import completed', retry: 'Retry', selected: 'Select sheets', copied: 'Prompt copied', copyFailed: 'Copy the prompt below', kinds: { understand:'Light explanation', fact:'Side fact', simplify:'Simplify', memory:'Memory aid', organize:'Organize', connection:'Connect ideas' } },
 ar: { title: 'استيراد بطاقات المساعد (JSON)', intro: 'بطاقات خفيفة ومتنوعة لـ Starmo وStarsea. ملف واحد لمادة واحدة.', one:'هذا الشيت', several:'شيتات محددة', all:'المادة كاملة', prompt:'نسخ البرومبت', file:'ملف JSON', text:'لصق JSON', preview:'معاينة البطاقات', confirm:'تأكيد الاستيراد', publish:'نشر البطاقات المراجَعة فورًا', saved:'تم الاستيراد', retry:'إعادة المحاولة', selected:'اختر الشيتات', copied:'تم نسخ البرومبت', copyFailed:'انسخ البرومبت من الحقل أدناه', kinds:{ understand:'شرح خفيف', fact:'معلومة جانبية', simplify:'تبسيط', memory:'طريقة حفظ', organize:'تنظيم', connection:'ربط أفكار' } }
};

export function buildCompanionPrompt(context, sheets) {
 if (!sheets.length) throw new Error('Select at least one sheet.');
 const template = { schema_version:1, subject_id:context.subject_id, edition:context.edition, view:context.view,
  sheets:sheets.map(sheet=>({sheet_id:sheet.sheet_id,source_version_id:sheet.source_version_id,cards:[{
   key:'concept-01-understand',page:1,kind:'understand',teaser:'Short inviting hook',question:'A short title or question',explanation:'A concise explanation.',followup_question:'Optional recall question',followup_answer:'Optional concise answer'
  }]})) };
 return `Create advanced micro-flashcards for Lockin study companions Starmo (boy) and Starsea (girl).
Use ONLY the PDFs supplied for the sheets listed below. If a PDF is missing or cannot be matched to its exact sheet, STOP and request it; do not invent cards or omit a selected sheet.
Goal: add brief, enjoyable, useful moments while studying, not a lecture or a summary of the entire page.
Choose the number of useful, distinct cards yourself based on each sheet: up to 40 cards per sheet, with no fixed target or minimum. Choose the mix yourself from understand (light explanation), fact (interesting side detail grounded in the PDF), simplify (plain-language contrast or example), memory (accurate mnemonic), connection (link concepts within the supplied material), and organize (short ordered relationship). Use fewer cards for short sources; never pad, repeat an idea or force equal counts per kind.
Write friendly, clear Arabic; preserve important English medical terms. No medical advice, unsupported trivia, invented source facts or promises of exam coverage. A memory aid or analogy must not distort the original fact. Use at most one light emoji per card, and only when helpful.
Keep teaser <=100 characters, question/title <=160, explanation <=600 (prefer 1-3 short sentences). Optional followup_question <=160 and followup_answer <=280; include both or neither. Do not turn every card into a quiz. Each card should communicate one useful idea.
Every question and every card about a specific concept MUST have page set to the physical PDF page number (starting at 1) that supports it. Only genuinely general information that is independent of any specific page may use page: null; those general cards can appear in any order while reading. Do not use null to avoid finding the source page. Never use an excluded or unavailable page. Count PDF pages, not printed page labels.
key is a unique stable ASCII identifier per sheet, 1-80 letters/digits/underscore/hyphen. Preserve it when correcting a card: re-import updates that card rather than duplicating it. Do not change IDs or edition/view; do not include publication flags or extra fields.
Return ONE valid JSON object only: no Markdown or commentary. The example below defines the schema; replace example card text and repeat cards as needed.
Selected PDFs: ${JSON.stringify(sheets.map(s=>({sheet_id:s.sheet_id,title:s.title,page_count:s.page_count})))}
${JSON.stringify(template,null,2)}`;
}

export function parseCompanionJson(text) {
 if (new globalThis.TextEncoder().encode(text).length > 2_000_000) throw new Error('JSON must be smaller than 2 MB.');
 const value = JSON.parse(text.replace(/^\uFEFF/, ''));
 if (!value || Array.isArray(value) || value.schema_version !== 1 || !Array.isArray(value.sheets) || !value.sheets.length) throw new Error('Expected schema_version 1 and a non-empty sheets array.');
 return value;
}
