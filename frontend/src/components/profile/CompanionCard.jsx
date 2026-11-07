import { useEffect, useId, useState } from "react";
import { Hand, Sparkles } from "lucide-react";
import { useI18n } from "../I18nProvider.jsx";
import { useCompanionPreferences } from "../../hooks/useCompanionPreferences.js";
import { CompanionCharacter, companionCharacters } from "../../workspace/assistance/CompanionCharacter.jsx";
import "../../workspace/assistance/study-companion.css";
import "./companion-card.css";

const copy = {
  ar: { title: "رفيقك الدراسي", choose: "اختر شخصيتك", hint: "يتطور مع نقاط دراستك", level: "المستوى", xp: "تقدم الرفيق", wave: "تحية", celebrate: "احتفال", tap: "اضغط للتحية", motion: "الحركة", unavailable: "تعذّر تحميل نقاط التقدم", local: "يُحفظ اختيارك على هذا الجهاز" },
  en: { title: "Your study companion", choose: "Choose your character", hint: "Grows with your study XP", level: "Level", xp: "Companion progress", wave: "Wave", celebrate: "Celebrate", tap: "Tap to say hello", motion: "Motion", unavailable: "XP is unavailable", local: "Your choice is saved on this device" }
};
const finite = (value) => Math.max(0, Number.isFinite(Number(value)) ? Number(value) : 0);

export function CompanionCard({ userId, xp, xpAvailable = true }) {
  const { locale } = useI18n();
  const c = copy[locale] || copy.en;
  const id = useId();
  const [preferences, setPreferences] = useCompanionPreferences(userId);
  const [cue, setCue] = useState({ state: "idle", sequence: 0 });
  const [reduced, setReduced] = useState(() => Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches));
  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const change = () => setReduced(Boolean(query?.matches));
    query?.addEventListener("change", change);
    return () => query?.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    if (cue.state === "idle") return;
    const timer = window.setTimeout(() => setCue(current => ({ ...current, state: "idle" })), 2800);
    return () => window.clearTimeout(timer);
  }, [cue.state, cue.sequence]);
  const name = preferences.character === "girl" ? "Starsea" : "Starmo";
  const target = finite(xp?.level_target);
  const current = Math.min(target, finite(xp?.level_progress));
  const motion = preferences.motion && !reduced;
  const emote = (state) => setCue(current => ({ state, sequence: current.sequence + 1 }));
  return <section className="profile-companion-card" aria-labelledby={id}>
    <header><div><h2 id={id}>{c.title}</h2><p>{c.hint}</p></div><span className="profile-companion-level">{c.level} {xpAvailable ? Math.max(1, finite(xp?.level)) : "—"}</span></header>
    <button className="profile-companion-stage" type="button" onClick={() => emote("invite")} aria-label={`${name} · ${c.tap}`}>
      <CompanionCharacter character={preferences.character} state={cue.state} sequenceKey={String(cue.sequence)} motion={motion} />
      <strong>{name}</strong>
    </button>
    <div className="profile-companion-emotes"><button type="button" onClick={() => emote("invite")}><Hand size={16} aria-hidden="true" /> <span>{c.wave}</span></button><button type="button" onClick={() => emote("saved")}><Sparkles size={16} aria-hidden="true" /> <span>{c.celebrate}</span></button></div>
    <div className="profile-companion-xp"><div><span>{c.xp}</span><strong dir="ltr">{xpAvailable ? `${current} / ${target} XP` : "—"}</strong></div>{xpAvailable && target > 0 ? <progress aria-label={c.xp} value={current} max={target} /> : <p role="status">{c.unavailable}</p>}</div>
    <div className="profile-companion-choices" role="group" aria-label={c.choose}>{Object.entries(companionCharacters).map(([character, asset]) => <button key={character} type="button" aria-pressed={preferences.character === character} onClick={() => { setPreferences(current => ({ ...current, character })); emote("invite"); }}><img src={asset.still} alt="" /><span>{character === "girl" ? "Starsea" : "Starmo"}</span></button>)}</div>
    <footer><small>{c.local}</small><label><input type="checkbox" checked={preferences.motion} onChange={event => setPreferences(current => ({ ...current, motion: event.target.checked }))} />{c.motion}</label></footer>
  </section>;
}
