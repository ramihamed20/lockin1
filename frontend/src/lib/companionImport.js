export const companionImportCopy = {
 en: { title: 'Import companion cards (JSON)', intro: 'Short, varied cards for Starmo and Starsea. One subject per file.', one: 'This sheet', several: 'Choose sheets', all: 'Whole subject', prompt: 'Copy prompt', antigravity: 'Generate with Antigravity on your server', antigravityHelp: 'Run this command on an authenticated development server, then upload the generated JSON here. Replace the admin email; nothing is published automatically.', antigravityCopy: 'Copy server command', antigravityDraftCopy: 'Copy command to add drafts directly', antigravityDraftHint: 'Adds only unpublished drafts for review; students will not see them.', file: 'JSON file', text: 'Paste JSON', preview: 'Preview cards', confirm: 'Confirm import', publish: 'Publish these reviewed cards immediately', saved: 'Import completed', retry: 'Retry', selected: 'Select sheets', copied: 'Prompt copied', copyFailed: 'Copy the prompt below', kinds: { understand:'Light explanation', fact:'Side fact', simplify:'Simplify', memory:'Memory aid', organize:'Organize', connection:'Connect ideas' } },
 ar: { title: 'استيراد بطاقات المساعد (JSON)', intro: 'بطاقات خفيفة ومتنوعة لـ Starmo وStarsea. ملف واحد لمادة واحدة.', one:'هذا الشيت', several:'شيتات محددة', all:'المادة كاملة', prompt:'نسخ البرومبت', antigravity:'توليد تلقائي عبر Antigravity على السيرفر', antigravityHelp:'شغّل هذا الأمر على سيرفر التطوير بعد استبدال بريد المشرف. ثم ارفع JSON الناتج هنا؛ لا تُنشر البطاقات تلقائيًا.', antigravityCopy:'نسخ أمر السيرفر', antigravityDraftCopy:'نسخ أمر التوليد وإضافة المسودات مباشرة', antigravityDraftHint:'ستُضاف البطاقات كمسودات غير منشورة حتى يراجعها المشرف ويعتمدها.', file:'ملف JSON', text:'لصق JSON', preview:'معاينة البطاقات', confirm:'تأكيد الاستيراد', publish:'نشر البطاقات المراجَعة فورًا', saved:'تم الاستيراد', retry:'إعادة المحاولة', selected:'اختر الشيتات', copied:'تم نسخ البرومبت', copyFailed:'انسخ البرومبت من الحقل أدناه', kinds:{ understand:'شرح خفيف', fact:'معلومة جانبية', simplify:'تبسيط', memory:'طريقة حفظ', organize:'تنظيم', connection:'ربط أفكار' } }
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
Where the source supports them, include these high-value teaching angles INSIDE the six supported kinds (do not invent new kind values):
- A common misconception or easily confused pair of terms: use simplify or connection; state the correct distinction with evidence from the page. Do not label a mistake "common" unless the PDF itself makes that claim.
- An exam-style conceptual pitfall: use understand or organize and show the exact qualifying detail, but NEVER claim a topic will be on an exam.
- A brief clinical/real-world learning example: use simplify or connection only when the supplied PDF actually supports the example. It is educational, not patient advice or an invented diagnosis.
- A helpful comparison, short sequence, or cause-and-effect: use connection or organize and link only facts present in the source.
Prioritize high-yield explanations, memorable distinctions and quick recall over filler. Distribute page-specific cards across useful pages without forcing one per page; cards tied to the current page should be helpful while it is open. Keep truly sheet-wide general cards rare.
Write friendly, clear Arabic suitable for Libyan medical and dentistry students; preserve important English medical terms. No medical advice, unsupported trivia, invented source facts, assumed common errors, or promises of exam coverage. A memory aid or analogy must not distort the original fact. If the PDF does not support a comparison, clinical example or extra fact, OMIT it rather than guessing. Use at most one light emoji per card, and only when helpful.
Keep teaser <=100 characters, question/title <=160, explanation <=600 (prefer 1-3 short sentences). Optional followup_question <=160 and followup_answer <=280; include both or neither. Do not turn every card into a quiz. Each card should communicate one useful idea.
Every question and every card about a specific concept MUST have page set to the physical PDF page number (starting at 1) that supports it. This is REQUIRED for explanations, comparisons, misconceptions, memory aids and clinical examples. Only genuinely general study guidance that is independent of any specific page may use page: null; those general cards can appear in any order while reading. Do not use null to avoid finding the source page. Never use an excluded or unavailable page. Count PDF pages, not printed page labels. When evidence spans pages, choose the page containing the principal fact; keep each card accurate without requiring an unsupplied page.
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
