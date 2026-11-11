import { tokenizeTranslationText } from "./translationFormatting.js";
import "./sheet-translation.css";

// Formatting tokens are converted into React nodes, never parsed as HTML.
// This safely supports both generated and manually edited translations.
export function TranslationRichText({ text, className = "" }) {
  return <div className={["sheet-translation__text", className].filter(Boolean).join(" ")} lang="ar" dir="rtl">
    {tokenizeTranslationText(text).map((part, index) => {
      const fragments = part.fragments.map((fragment, fragmentIndex) => fragment.kind === "term"
        ? <bdi className="sheet-translation__medical-term" lang="en" dir="ltr" key={fragmentIndex}>{fragment.text}</bdi>
        : fragment.text);
      if (part.kind === "highlight") return <mark className="sheet-translation__key-line" key={index}>{fragments}</mark>;
      if (part.kind === "emphasis") return <strong className="sheet-translation__key-word" key={index}>{fragments}</strong>;
      return <span key={index}>{fragments}</span>;
    })}
  </div>;
}
