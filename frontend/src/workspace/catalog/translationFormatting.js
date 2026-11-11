// Deliberately tiny, text-only markup for safe page translations.
// ==important statement== adds a soft highlight; **important word** adds emphasis.
// English tokens remain readable left-to-right and receive a distinct term color.
// React renders the returned pieces as text nodes; no HTML is ever interpreted.
const INLINE_MARKUP = /(==[^=\n]+==|\*\*[^*\n]+\*\*)/g;
const ENGLISH_TERM = /([A-Za-z][A-Za-z0-9][A-Za-z0-9/-]*)/g;

export function tokenizeTranslationText(value) {
  return String(value ?? "").split(INLINE_MARKUP).filter(Boolean).map((part) => {
    let kind = "text";
    let inner = part;
    if (part.startsWith("==") && part.endsWith("==")) {
      kind = "highlight";
      inner = part.slice(2, -2);
    } else if (part.startsWith("**") && part.endsWith("**")) {
      kind = "emphasis";
      inner = part.slice(2, -2);
    }
    return {
      kind,
      fragments: inner.split(ENGLISH_TERM).filter(Boolean).map((text) => ({
        text,
        kind: /^[A-Za-z][A-Za-z0-9][A-Za-z0-9/-]*$/.test(text) ? "term" : "text",
      })),
    };
  });
}
