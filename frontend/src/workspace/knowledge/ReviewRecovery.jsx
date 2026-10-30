import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { knowledgeApi } from "../../api/knowledge.js";
import { useI18n } from "../../components/I18nProvider.jsx";

export default function ReviewRecovery({ itemId }) {
  const { t } = useI18n();
  const [state, setState] = useState({ id: "", links: [] });
  useEffect(() => {
    let active = true;
    knowledgeApi.recovery(itemId).then(data => { if (active) setState({ id: itemId, links: Array.isArray(data.links) ? data.links : [] }); }).catch(() => { if (active) setState({ id: itemId, links: [] }); });
    return () => { active = false; };
  }, [itemId]);
  return state.id === itemId && state.links.length ? <section className="connected-practice"><p>{t("knowledge.reviewSuggestion")}</p>{state.links.map(link => <Link className="btn btn-soft" key={link.concept_id} to={link.start_url}>{t("knowledge.explainConcept")} · <span dir="auto">{link.title}</span></Link>)}</section> : null;
}
