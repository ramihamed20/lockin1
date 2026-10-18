import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { knowledgeApi } from "../../api/knowledge.js";
import { useI18n } from "../../components/I18nProvider.jsx";

export default function KnowledgeShelf({ userId }) {
  const { t } = useI18n();
  const [library, setLibrary] = useState(null);
  useEffect(() => {
    let current = true;
    knowledgeApi.library().then((value) => { if (current) setLibrary(value); }).catch(() => {});
    return () => { current = false; };
  }, [userId]);
  if (!library?.enabled || !library.documents?.length) return null;
  return <section className="review-center-section" aria-labelledby="knowledge-library-title">
    <header className="review-section-heading"><h2 id="knowledge-library-title">{t("knowledge.knowledge")}</h2></header>
    <div className="review-subject-list">{library.documents.map((document) => <Link className="review-subject-row" key={document.id} to={document.reader_url}><span><strong dir="auto">{document.title}</strong><small>{t("knowledge.libraryHint")}</small></span></Link>)}</div>
  </section>;
}
